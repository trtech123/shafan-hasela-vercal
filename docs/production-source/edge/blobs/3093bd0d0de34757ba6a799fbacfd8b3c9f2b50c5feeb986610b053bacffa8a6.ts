import { createPelecardTestHandler } from "../_shared/pelecard-test-handler.ts";
import { createPelecardTestRuntime } from "../_shared/pelecard-test-runtime.ts";
import { paymentJson } from "../_shared/payment-http.ts";

Deno.serve(async (request: Request) => {
  try { return await createPelecardTestHandler(createPelecardTestRuntime())(request); }
  catch { return paymentJson({ error: { code: "invalid_configuration" } }, 503); }
});
