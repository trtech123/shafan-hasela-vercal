import { describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { assetManifest, createAssetLoader } from "../../../supabase/functions/whatsapp-webhook/_deployed_shared/chatbot/assets.js";
import { deliverAttachment } from "../../../supabase/functions/whatsapp-webhook/_deployed_shared/chatbot/deliver-attachment.js";

const message = {
  id: "synthetic-message",
  conversationId: "synthetic-conversation",
  assetId: assetManifest[0].id,
  assetChecksum: assetManifest[0].sha256,
};
const event = { channel: "whatsapp", externalContactId: "972500000000" };

function dependencies(claim = true) {
  return {
    repository: {
      claimAttachment: vi.fn().mockResolvedValue(claim),
      updateOutboundDelivery: vi.fn().mockResolvedValue(),
      createHandoff: vi.fn().mockResolvedValue(),
    },
    sender: { sendAttachment: vi.fn().mockResolvedValue({ providerMessageId: "synthetic-provider-id" }) },
  };
}

describe("deployed chatbot bundle", () => {
  test("keeps all live assets private and uses only bundled imports", () => {
    expect(assetManifest).toHaveLength(14);
    expect(new Set(assetManifest.map((asset) => asset.id)).size).toBe(14);
    expect(assetManifest.every((asset) => asset.enabled && asset.bucket === "chatbot-assets")).toBe(true);
    const entry = readFileSync(new URL("../../../supabase/functions/whatsapp-webhook/index.ts", import.meta.url), "utf8");
    expect(entry).toContain("./_deployed_shared/chatbot/process-event.js");
    expect(entry).toContain("./_deployed_shared/chatbot/assets.js");
    expect(entry).not.toContain("../_shared/chatbot/");
  });

  test("claims before provider send and records acceptance", async () => {
    const { repository, sender } = dependencies();
    await expect(deliverAttachment({ event, message, repository, sender })).resolves.toBe(true);
    expect(repository.claimAttachment).toHaveBeenCalledWith(message.id);
    expect(sender.sendAttachment).toHaveBeenCalledOnce();
    expect(repository.updateOutboundDelivery).toHaveBeenCalledWith(message.id, {
      status: "accepted", providerMessageId: "synthetic-provider-id",
    });
  });

  test("duplicate claim cannot send a second attachment", async () => {
    const { repository, sender } = dependencies(false);
    await expect(deliverAttachment({ event, message, repository, sender })).resolves.toBe(false);
    expect(sender.sendAttachment).not.toHaveBeenCalled();
  });

  test("uncertain provider response records handoff without retry", async () => {
    const { repository, sender } = dependencies();
    sender.sendAttachment.mockRejectedValue(Object.assign(new Error("network_lost"), { uncertain: true }));
    await expect(deliverAttachment({ event, message, repository, sender })).rejects.toThrow("chatbot_attachment_uncertain");
    expect(repository.updateOutboundDelivery).toHaveBeenCalledWith(message.id, { status: "uncertain" });
    expect(repository.createHandoff).toHaveBeenCalledWith(expect.objectContaining({ reason: "document_delivery_uncertain" }));
    expect(sender.sendAttachment).toHaveBeenCalledOnce();
  });

  test("refuses an object whose bytes fail the manifest checksum", async () => {
    const asset = { ...assetManifest[0], sizeBytes: 5, mimeType: "application/pdf" };
    const blob = new Blob(["wrong"], { type: asset.mimeType });
    const client = { storage: { from: vi.fn(() => ({ download: vi.fn().mockResolvedValue({ data: blob, error: null }) })) } };
    await expect(createAssetLoader(client, [asset])(asset.id, asset.sha256)).rejects.toThrow("chatbot_asset_unavailable");
  });
});
