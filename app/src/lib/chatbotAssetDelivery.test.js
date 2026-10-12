import { describe, expect, test, vi } from "vitest";
import { createHash } from "node:crypto";
import { createAssetLoader, getAsset, assetManifest } from "../../../supabase/functions/_shared/chatbot/assets.js";
import { createWhatsAppSender } from "../../../supabase/functions/whatsapp-webhook/sender.js";

const bytes = new TextEncoder().encode("%PDF-1.7\nfixture");
const fixture = { ...assetManifest[0], sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
const blob = () => new Blob([bytes], { type: "application/pdf" });
const recipient = { channel: "whatsapp", to: "972501234567", assetId: "carmel", checksum: fixture.sha256 };
const ok = (body) => new Response(JSON.stringify(body), { status: 200 });

describe("private allowlisted chatbot assets", () => {
  test("manifest contains only nine approved assets with unique keys and checksums", () => {
    expect(assetManifest.map((a) => a.auditId)).toEqual(["D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10"]);
    expect(new Set(assetManifest.map((a) => a.objectKey)).size).toBe(9);
    for (const a of assetManifest) {
      expect(a.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(a.objectKey).toContain(a.sha256);
      expect(a.enabled).toBe(true);
      expect(a.sizeBytes).toBeGreaterThan(0);
    }
    expect(getAsset("https://evil.invalid/a.pdf")).toBeNull();
    expect(getAsset("carmel", [{ ...fixture, enabled: false }])).toBeNull();
  });
  test("downloads privately and verifies exact bytes, not a signed URL", async () => {
    const download = vi.fn().mockResolvedValue({ data: blob(), error: null });
    const from = vi.fn().mockReturnValue({ download });
    const load = createAssetLoader({ storage: { from } }, [fixture]);
    expect((await load("carmel", fixture.sha256)).asset.id).toBe("carmel");
    expect(from).toHaveBeenCalledWith("chatbot-assets");
    expect(download).toHaveBeenCalledWith(fixture.objectKey);
  });
  test.each(["missing", "disabled", "checksum", "size", "mime", "version"])("fails closed for %s", async (mode) => {
    const a = mode === "disabled" ? { ...fixture, enabled: false } : fixture;
    const data = mode === "checksum" ? new Blob([new Uint8Array(bytes.length)], { type: fixture.mimeType }) : mode === "size" ? new Blob(["x"], { type: fixture.mimeType }) : mode === "mime" ? new Blob([bytes], { type: "text/html" }) : blob();
    const download = vi.fn().mockResolvedValue(mode === "missing" ? { error: { message: "secret" } } : { data });
    await expect(createAssetLoader({ storage: { from: () => ({ download }) } }, [a])("carmel", mode === "version" ? "f".repeat(64) : fixture.sha256)).rejects.toThrow("chatbot_asset_unavailable");
  });
});

describe("Meta attachment sender", () => {
  test.each(["document", "image"])("uploads bytes then sends %s by media ID only", async (messageType) => {
    const asset = { ...fixture, messageType, mimeType: messageType === "image" ? "image/jpeg" : "application/pdf" };
    const loadAsset = vi.fn().mockResolvedValue({ asset, blob: blob() });
    const fetchImpl = vi.fn().mockResolvedValueOnce(ok({ id: "media-1" })).mockResolvedValueOnce(ok({ messages: [{ id: "wamid.1" }] }));
    const sender = createWhatsAppSender({ token: "secret", phoneNumberId: "phone-1", fetchImpl, loadAsset });
    await expect(sender.sendAttachment(recipient)).resolves.toEqual({ providerMessageId: "wamid.1" });
    expect(fetchImpl.mock.calls[0][0]).toMatch(/\/phone-1\/media$/);
    expect(fetchImpl.mock.calls[0][1].body.get("messaging_product")).toBe("whatsapp");
    expect(fetchImpl.mock.calls[0][1].body.get("file").size).toBe(bytes.length);
    const payload = JSON.parse(fetchImpl.mock.calls[1][1].body);
    expect(payload.type).toBe(messageType);
    expect(payload[messageType].id).toBe("media-1");
    expect(payload[messageType].caption).toContain("אינו אישור זמינות");
    expect(payload[messageType].filename).toBe(messageType === "document" ? fixture.filename : undefined);
    expect(JSON.stringify(payload)).not.toMatch(/https?:|objectKey|sha256|secret/);
  });
  test.each(["timeout", "500", "malformed", "no_id"])("marks send outcome uncertain on %s without retry", async (mode) => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(ok({ id: "media-1" }));
    if (mode === "timeout") fetchImpl.mockRejectedValueOnce(new Error("secret network detail"));
    else fetchImpl.mockResolvedValueOnce(mode === "500" ? new Response("secret", { status: 500 }) : mode === "malformed" ? new Response("not json") : ok({}));
    const sender = createWhatsAppSender({ token: "secret", phoneNumberId: "p", fetchImpl, loadAsset: async () => ({ asset: fixture, blob: blob() }) });
    await expect(sender.sendAttachment(recipient)).rejects.toMatchObject({ message: "whatsapp_attachment_uncertain", uncertain: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  test("upload failure never sends a message, and provider rejection is definitive", async () => {
    for (const uploadFails of [true, false]) {
      const fetchImpl = vi.fn();
      if (!uploadFails) fetchImpl.mockResolvedValueOnce(ok({ id: "media-1" }));
      fetchImpl.mockResolvedValueOnce(new Response("provider secret", { status: 400 }));
      const sender = createWhatsAppSender({ token: "secret", phoneNumberId: "p", fetchImpl, loadAsset: async () => ({ asset: fixture, blob: blob() }) });
      await expect(sender.sendAttachment(recipient)).rejects.toMatchObject({ message: "whatsapp_attachment_failed", uncertain: false });
      expect(fetchImpl).toHaveBeenCalledTimes(uploadFails ? 1 : 2);
    }
  });
  test("rejects unsupported channels/recipients before loading any asset", async () => {
    const loadAsset = vi.fn();
    const sender = createWhatsAppSender({ token: "secret", phoneNumberId: "p", loadAsset, fetchImpl: vi.fn() });
    await expect(sender.sendAttachment({ ...recipient, channel: "email" })).rejects.toThrow("unsupported_channel");
    await expect(sender.sendAttachment({ ...recipient, to: "invalid" })).rejects.toThrow("invalid_recipient");
    expect(loadAsset).not.toHaveBeenCalled();
  });
});
