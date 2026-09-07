import { describe, expect, test, vi } from "vitest";
import {
  EXPECTED_TEMPLATE,
  MAX_PDF_BYTES,
  buildDocumentPayload,
  buildTemplatePayload,
  buildTextPayload,
  classifyTemplate,
  decodeAndValidatePdf,
  normalizePhone,
  resolveMode,
  sanitizePdfFileName,
  validateTemplateRequest,
} from "../../../supabase/functions/send-whatsapp/payload.js";
import { authorizeCaller } from "../../../supabase/functions/send-whatsapp/authorization.js";
import { createWhatsAppHandler } from "../../../supabase/functions/send-whatsapp/handler.js";
import { NetworkTimeoutError, fetchWithTimeout } from "../../../supabase/functions/send-whatsapp/network.js";
import { executeTemplateMode } from "../../../supabase/functions/send-whatsapp/template-mode.js";

const VALID_PDF_BASE64 = "JVBERi0xLjQKJSVFT0Y=";
const approvedTemplate = {
  id: "template-1",
  name: EXPECTED_TEMPLATE.name,
  language: EXPECTED_TEMPLATE.language,
  category: "UTILITY",
  status: "APPROVED",
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function templateArgs(overrides = {}) {
  return {
    fetchImpl: vi.fn(),
    token: "server-only-token",
    phoneNumberId: "phone-number-id",
    wabaId: "waba-id",
    phone: "972501234567",
    pdfBytes: Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]),
    fileName: "order.pdf",
    name: EXPECTED_TEMPLATE.name,
    language: EXPECTED_TEMPLATE.language,
    bodyParameters: ["ישראל ישראלי", "ORD-1234", "15/08/2026"],
    timeoutMs: 100,
    ...overrides,
  };
}

function makeRequest(body, headers = { Authorization: "Bearer user-jwt" }) {
  return new Request("https://example.test/send-whatsapp", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function makeHandler(overrides = {}) {
  const values = {
    META_WHATSAPP_TOKEN: "server-only-token",
    META_PHONE_NUMBER_ID: "phone-number-id",
    META_WABA_ID: "waba-id",
  };
  return createWhatsAppHandler({
    authorize: vi.fn().mockResolvedValue({ ok: true, role: "admin" }),
    getEnv: (name) => values[name],
    fetchImpl: vi.fn(),
    logger: { info: vi.fn(), error: vi.fn() },
    timeoutMs: 100,
    ...overrides,
  });
}

describe("WhatsApp request and payload contract", () => {
  test("keeps implicit and explicit free-form modes backward compatible", () => {
    expect(resolveMode({ message: "hello" })).toBe("text");
    expect(resolveMode({ message: "hello", pdfBase64: VALID_PDF_BASE64 })).toBe("document");
    expect(resolveMode({ mode: "text", pdfBase64: VALID_PDF_BASE64 })).toBe("text");
    expect(resolveMode({ mode: "document" })).toBe("document");
    expect(resolveMode({ mode: "template" })).toBe("template");
  });

  test("normalizes supported phone formats and rejects invalid E.164 lengths", () => {
    expect(normalizePhone("050-123-4567")).toBe("972501234567");
    expect(normalizePhone("+972 50 123 4567")).toBe("972501234567");
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("1234567890123456")).toBeNull();
  });

  test("retains the existing text and free-form document payloads", () => {
    expect(buildTextPayload({ phone: "972501234567", message: "hello" })).toEqual({
      messaging_product: "whatsapp",
      to: "972501234567",
      type: "text",
      text: { body: "hello" },
    });
    expect(buildDocumentPayload({
      phone: "972501234567",
      mediaId: "media-1",
      fileName: "order.pdf",
      message: "caption",
    })).toEqual({
      messaging_product: "whatsapp",
      to: "972501234567",
      type: "document",
      document: { id: "media-1", filename: "order.pdf", caption: "caption" },
    });
  });

  test.each([[], ["a"], ["a", "b"], ["a", "b", "c", "d"], ["a", "", "c"]])(
    "rejects invalid body parameters %j",
    (bodyParameters) => {
      expect(validateTemplateRequest({
        pdfBase64: VALID_PDF_BASE64,
        template: { ...EXPECTED_TEMPLATE, bodyParameters },
      })).toMatchObject({ ok: false, code: "template_parameter_mismatch" });
    },
  );

  test("rejects any template name or language outside the approved contract", () => {
    expect(validateTemplateRequest({
      pdfBase64: VALID_PDF_BASE64,
      template: { name: "another_template", language: "he", bodyParameters: ["a", "b", "c"] },
    })).toMatchObject({ ok: false, code: "invalid_template" });
    expect(validateTemplateRequest({
      pdfBase64: VALID_PDF_BASE64,
      template: { name: EXPECTED_TEMPLATE.name, language: "en", bodyParameters: ["a", "b", "c"] },
    })).toMatchObject({ ok: false, code: "invalid_template" });
  });

  test("rejects an activity date that does not match the approved DD/MM/YYYY parameter", () => {
    expect(validateTemplateRequest({
      pdfBase64: VALID_PDF_BASE64,
      template: { ...EXPECTED_TEMPLATE, bodyParameters: ["customer", "ORD-1", "—"] },
    })).toMatchObject({ ok: false, code: "template_parameter_mismatch" });
  });

  test("builds a document-header template with three ordered text parameters", () => {
    expect(buildTemplatePayload({
      phone: "972501234567",
      mediaId: "media-1",
      fileName: "order.pdf",
      name: EXPECTED_TEMPLATE.name,
      language: EXPECTED_TEMPLATE.language,
      bodyParameters: ["ישראל ישראלי", "ORD-1234", "15/08/2026"],
    })).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "972501234567",
      type: "template",
      template: {
        name: "order_confirmation_pdf",
        language: { code: "he" },
        components: [
          {
            type: "header",
            parameters: [{ type: "document", document: { id: "media-1", filename: "order.pdf" } }],
          },
          {
            type: "body",
            parameters: [
              { type: "text", text: "ישראל ישראלי" },
              { type: "text", text: "ORD-1234" },
              { type: "text", text: "15/08/2026" },
            ],
          },
        ],
      },
    });
  });
});

describe("PDF and filename validation", () => {
  test("accepts a PDF signature and reports its decoded size", () => {
    const result = decodeAndValidatePdf(VALID_PDF_BASE64);
    expect(result).toMatchObject({ ok: true });
    expect(result.value.byteLength).toBeGreaterThan(5);
  });

  test("rejects malformed base64, non-PDF content, and oversized documents", () => {
    expect(decodeAndValidatePdf("%%%" )).toMatchObject({ ok: false, code: "invalid_pdf" });
    expect(decodeAndValidatePdf("aGVsbG8=")).toMatchObject({ ok: false, code: "invalid_pdf_content" });
    expect(decodeAndValidatePdf("JVBERi0=")).toMatchObject({ ok: false, code: "invalid_pdf_content" });
    expect(decodeAndValidatePdf("ignored", {
      decodeBase64: () => new Uint8Array(MAX_PDF_BYTES + 1),
    })).toMatchObject({ ok: false, code: "pdf_too_large" });
  });

  test("sanitizes paths and control characters while retaining a PDF filename", () => {
    expect(sanitizePdfFileName("../אישור\u0000:הזמנה.pdf")).toBe(".._אישור_הזמנה.pdf");
    expect(sanitizePdfFileName("invoice.exe")).toBe("invoice.exe.pdf");
    expect(sanitizePdfFileName(" ")).toBe("order.pdf");
  });
});

describe("caller authorization", () => {
  function authClient({ user = { id: "user-1" }, userError = null, role = "admin", profileError = null } = {}) {
    return {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: userError }) },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({ data: role ? { role } : null, error: profileError }),
          })),
        })),
      })),
    };
  }

  test.each(["admin", "operations", "cashier"])("allows the %s Orders role", async (role) => {
    const createClientImpl = vi.fn(() => authClient({ role }));
    const result = await authorizeCaller({
      request: makeRequest({ message: "hello", phone: "0501234567" }),
      supabaseUrl: "https://project.supabase.co",
      anonKey: "anon-key",
      createClientImpl,
    });
    expect(result).toEqual({ ok: true, role });
  });

  test("rejects a missing/invalid session and an unauthorized role", async () => {
    expect(await authorizeCaller({
      request: makeRequest({}, {}),
      supabaseUrl: "url",
      anonKey: "key",
      createClientImpl: vi.fn(),
    })).toMatchObject({ ok: false, status: 401, body: { code: "unauthorized" } });

    expect(await authorizeCaller({
      request: makeRequest({}),
      supabaseUrl: "url",
      anonKey: "key",
      createClientImpl: vi.fn(() => authClient({ user: null })),
    })).toMatchObject({ ok: false, status: 401, body: { code: "unauthorized" } });

    expect(await authorizeCaller({
      request: makeRequest({}),
      supabaseUrl: "url",
      anonKey: "key",
      createClientImpl: vi.fn(() => authClient({ role: "instructor" })),
    })).toMatchObject({ ok: false, status: 403, body: { code: "forbidden" } });
  });

  test("reports a profile lookup failure as unavailable instead of forbidden", async () => {
    expect(await authorizeCaller({
      request: makeRequest({}),
      supabaseUrl: "url",
      anonKey: "key",
      createClientImpl: vi.fn(() => authClient({ role: null, profileError: new Error("database unavailable") })),
    })).toMatchObject({ ok: false, status: 503, body: { code: "authorization_failed" } });
  });
});

describe("template status and send behavior", () => {
  test.each([
    [[], "template_missing"],
    [[{ ...approvedTemplate, status: "PENDING" }], "template_pending"],
    [[{ ...approvedTemplate, status: "REJECTED", rejected_reason: "INVALID_FORMAT" }], "template_rejected"],
    [[{ ...approvedTemplate, status: "PAUSED" }], "template_unavailable"],
  ])("classifies unavailable templates", (templates, code) => {
    expect(classifyTemplate(templates, EXPECTED_TEMPLATE.name, EXPECTED_TEMPLATE.language))
      .toMatchObject({ ok: false, code });
  });

  test.each([
    [[], "template_missing"],
    [[{ ...approvedTemplate, status: "PENDING" }], "template_pending"],
    [[{ ...approvedTemplate, status: "REJECTED" }], "template_rejected"],
    [[{ ...approvedTemplate, status: "DISABLED" }], "template_unavailable"],
  ])("stops before media upload for non-approved status", async (templates, code) => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({ data: templates }));
    const result = await executeTemplateMode(templateArgs({ fetchImpl }));
    expect(result.body).toMatchObject({ ok: false, code });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("uploads and sends only after an approved lookup", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: [approvedTemplate] }))
      .mockResolvedValueOnce(jsonResponse({ id: "media-1" }))
      .mockResolvedValueOnce(jsonResponse({ messages: [{ id: "wamid.1" }] }));
    const result = await executeTemplateMode(templateArgs({ fetchImpl }));

    expect(result).toEqual({ status: 200, body: { ok: true, mode: "template", messageId: "wamid.1" } });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[0][0]).toContain("/waba-id/message_templates?");
    expect(fetchImpl.mock.calls[0][0]).toContain("name=order_confirmation_pdf");
    const uploadedFile = fetchImpl.mock.calls[1][1].body.get("file");
    expect(uploadedFile).toMatchObject({ name: "order.pdf", type: "application/pdf", size: 5 });
    const sendInit = fetchImpl.mock.calls[2][1];
    expect(JSON.parse(sendInit.body)).toEqual(buildTemplatePayload({
      phone: "972501234567",
      mediaId: "media-1",
      fileName: "order.pdf",
      name: EXPECTED_TEMPLATE.name,
      language: EXPECTED_TEMPLATE.language,
      bodyParameters: ["ישראל ישראלי", "ORD-1234", "15/08/2026"],
    }));
  });

  test("maps lookup, upload, and send failures to stable public codes", async () => {
    const lookupFailure = vi.fn().mockResolvedValueOnce(jsonResponse({ error: { message: "private detail" } }, 500));
    expect(await executeTemplateMode(templateArgs({ fetchImpl: lookupFailure })))
      .toMatchObject({ status: 502, body: { ok: false, code: "template_lookup_failed", error: "Unable to check WhatsApp template status" } });

    const uploadFailure = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: [approvedTemplate] }))
      .mockResolvedValueOnce(jsonResponse({ error: { message: "private detail" } }, 400));
    expect(await executeTemplateMode(templateArgs({ fetchImpl: uploadFailure })))
      .toMatchObject({ status: 502, body: { ok: false, code: "media_upload_failed", error: "Unable to upload the PDF to WhatsApp" } });

    const sendFailure = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: [approvedTemplate] }))
      .mockResolvedValueOnce(jsonResponse({ id: "media-1" }))
      .mockResolvedValueOnce(jsonResponse({ error: { message: "private detail" } }, 400));
    expect(await executeTemplateMode(templateArgs({ fetchImpl: sendFailure })))
      .toMatchObject({ status: 502, body: { ok: false, code: "meta_send_failed", error: "WhatsApp rejected the template message" } });
  });
});

describe("network timeout and HTTP adapter", () => {
  test("aborts a stalled Meta request with a typed timeout", async () => {
    const stalledFetch = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    await expect(fetchWithTimeout(stalledFetch, "https://graph.facebook.com/test", {}, 5))
      .rejects.toBeInstanceOf(NetworkTimeoutError);
  });

  test("authorizes before reading payload or calling Meta", async () => {
    const fetchImpl = vi.fn();
    const handler = makeHandler({
      authorize: vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        body: { ok: false, code: "unauthorized", error: "Authentication required" },
      }),
      fetchImpl,
    });
    const response = await handler(makeRequest({ phone: "0501234567", message: "secret payload" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ ok: false, code: "unauthorized" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("preserves existing text mode through the authenticated handler", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({ messages: [{ id: "wamid.text" }] }));
    const logger = { info: vi.fn(), error: vi.fn() };
    const handler = makeHandler({ fetchImpl, logger });
    const response = await handler(makeRequest({ phone: "0501234567", message: "hello" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, mode: "text", messageId: "wamid.text" });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual(
      buildTextPayload({ phone: "972501234567", message: "hello" }),
    );
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("0501234567");
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("hello");
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("server-only-token");
  });

  test("preserves existing free-form PDF mode and validates the document first", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: "media-1" }))
      .mockResolvedValueOnce(jsonResponse({ messages: [{ id: "wamid.doc" }] }));
    const handler = makeHandler({ fetchImpl });
    const response = await handler(makeRequest({
      phone: "0501234567",
      message: "caption",
      pdfBase64: VALID_PDF_BASE64,
      fileName: "order.pdf",
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, mode: "document", messageId: "wamid.doc" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual(buildDocumentPayload({
      phone: "972501234567",
      mediaId: "media-1",
      fileName: "order.pdf",
      message: "caption",
    }));
  });

  test("returns a stable timeout without exposing infrastructure details", async () => {
    const handler = makeHandler({
      fetchImpl: vi.fn().mockRejectedValue(new NetworkTimeoutError()),
    });
    const response = await handler(makeRequest({ phone: "0501234567", message: "hello" }));
    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({
      ok: false,
      code: "network_timeout",
      error: "WhatsApp did not respond in time",
    });
  });
});
