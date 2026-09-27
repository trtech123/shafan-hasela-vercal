import { paymentJson } from "./payment-http.ts";
import { assertPelecardTestMode, type ReadEnvironment } from "./pelecard-test-config.ts";

/** Temporary operational probe. Deploy only for preflight, then delete it and
 * its short-lived authorization secret. It cannot initialize a payment. */
export function createTestPreflightHandler(deps: {
  read: ReadEnvironment;
  preflight: () => Promise<{ authenticated: true }>;
  now?: () => number;
}) {
  return async (request: Request) => {
    try {
      const expected = deps.read("PELECARD_TEST_PREFLIGHT_KEY");
      const expires = Number(deps.read("PELECARD_TEST_PREFLIGHT_EXPIRES"));
      const now = (deps.now ?? Date.now)();
      if (request.method !== "POST" || !expected || expected.length < 64 ||
        !Number.isSafeInteger(expires) || expires <= now || expires > now + 900_000 ||
        request.headers.get("Authorization") !== `Bearer ${expected}`) {
        return paymentJson({ error: { code: "forbidden" } }, 403);
      }
      assertPelecardTestMode(deps.read);
      await deps.preflight();
      return paymentJson({ mode: "test", authenticated: true, transactionCreated: false }, 200);
    } catch {
      return paymentJson({ mode: "test", authenticated: false, transactionCreated: false }, 502);
    }
  };
}
