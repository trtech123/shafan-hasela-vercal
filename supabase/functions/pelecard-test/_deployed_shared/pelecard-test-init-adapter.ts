import { PaymentError } from "./payment-types.ts";
import { assertPelecardTestMode, type ReadEnvironment } from "./pelecard-test-config.ts";
import { logPelecardTestTransportFailure } from "./pelecard-test-diagnostics.ts";

export function readTestInitTransport(read: ReadEnvironment): "edge" | "node_v1" {
  const value = read("PELECARD_TEST_INIT_TRANSPORT");
  if (value === undefined || value === "edge") return "edge";
  if (value === "node_v1") return value;
  throw new PaymentError("invalid_configuration");
}

export function createPelecardTestInitAdapter(read: ReadEnvironment, fetcher: typeof fetch = fetch, now = Date.now) {
  return async (id: string): Promise<unknown> => {
    assertPelecardTestMode(read);
    if (read("PELECARD_TEST_TRANSACTION_ENABLED") !== "true") throw new PaymentError("capability_disabled");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new PaymentError("invalid_input");
    let url: URL;
    try { url = new URL(read("PELECARD_TEST_INIT_ADAPTER_URL") ?? ""); } catch { throw new PaymentError("invalid_configuration"); }
    const key = read("PELECARD_TEST_INIT_ADAPTER_AUTH_KEY");
    if (url.protocol !== "https:" || !/^[a-z0-9][a-z0-9-]*\.vercel\.app$/.test(url.hostname) || url.port || url.username || url.password || url.pathname !== "/api/init" || url.search || url.hash || !key || !/^[a-f0-9]{64,128}$/.test(key)) throw new PaymentError("invalid_configuration");
    const body = JSON.stringify({ testPaymentId: id, issuedAt: now() });
    const encoder = new TextEncoder();
    const signingKey = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", signingKey, encoder.encode("POST\n/api/init\n" + body))), b => b.toString(16).padStart(2, "0")).join("");
    let response: Response | undefined;
    try {
      response = await fetcher(url.href, { method: "POST", redirect: "error", signal: AbortSignal.timeout(35_000), headers: { "Content-Type": "application/json", "x-pelecard-signature": signature }, body });
      if (!response.ok || response.redirected || !response.body) throw new PaymentError("provider_unavailable");
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      while (true) {
        const part = await reader.read(); if (part.done) break;
        size += part.value.length;
        if (size > 8192) { await reader.cancel(); throw new PaymentError("invalid_provider_response"); }
        chunks.push(part.value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch (error) {
      logPelecardTestTransportFailure(error, { operation: "init", testPaymentId: id, stage: response ? "response_body" : "fetch", httpStatus: response?.status });
      if (error instanceof PaymentError) throw error;
      throw new PaymentError("provider_unavailable");
    }
  };
}
