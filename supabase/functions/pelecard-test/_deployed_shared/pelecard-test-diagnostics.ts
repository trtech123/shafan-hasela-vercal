type Operation = "init" | "lookup" | "validate" | "preflight";
type Stage = "fetch" | "response_body" | "http_response";
interface Context {
  operation: Operation;
  stage: Stage;
  testPaymentId?: string;
  httpStatus?: number;
}

const names = new Set(["Error", "TypeError", "TimeoutError", "AbortError", "SyntaxError", "PaymentError"]);
const codes: Record<string, string> = {
  ENOTFOUND: "dns_failure", EAI_AGAIN: "dns_failure",
  ECONNREFUSED: "connection_refused", ECONNRESET: "connection_reset",
  ETIMEDOUT: "timeout", EPROTO: "tls_protocol_error",
  CERT_HAS_EXPIRED: "certificate_expired", ERR_TLS_CERT_ALTNAME_INVALID: "certificate_hostname_mismatch",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "certificate_chain_failure",
};

/** Preserve diagnostic meaning, never arbitrary messages, stacks or provider data. */
export function logPelecardTestTransportFailure(
  error: unknown,
  context: Context,
  logger: (diagnostic: Record<string, unknown>) => void = (diagnostic) => console.error(JSON.stringify(diagnostic)),
): void {
  try {
    const diagnostic: Record<string, unknown> = {
      event: "pelecard_test_transport_failure", operation: context.operation,
      stage: context.stage, reason: "unclassified",
    };
    if (context.testPaymentId && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(context.testPaymentId)) {
      diagnostic.testPaymentId = context.testPaymentId;
    }
    if (Number.isInteger(context.httpStatus) && context.httpStatus! >= 100 && context.httpStatus! <= 599) {
      diagnostic.httpStatus = context.httpStatus;
    }
    let current = error;
    for (let depth = 0; depth < 3 && current && typeof current === "object"; depth++) {
      const item = current as { name?: unknown; code?: unknown; message?: unknown; cause?: unknown };
      if (typeof item.name === "string" && names.has(item.name)) {
        diagnostic[depth === 0 ? "errorName" : "causeName"] = item.name;
      }
      if (typeof item.code === "string" && Object.hasOwn(codes, item.code)) {
        diagnostic.exceptionCode = item.code;
        diagnostic.reason = codes[item.code];
      }
      if (item.name === "TimeoutError" || item.name === "AbortError") diagnostic.reason = "timeout_or_abort";
      if (item.name === "TimeoutError") diagnostic.reason = "timeout";
      if (typeof item.message === "string" && /received fatal alert: HandshakeFailure|ssl\/tls alert handshake failure/i.test(item.message)) {
        diagnostic.reason = "tls_handshake_failure";
        diagnostic.detail = "received fatal alert: HandshakeFailure";
        break;
      }
      current = item.cause;
    }
    logger(diagnostic);
  } catch {
    // A diagnostic sink must not change payment behavior or expose its error.
  }
}
