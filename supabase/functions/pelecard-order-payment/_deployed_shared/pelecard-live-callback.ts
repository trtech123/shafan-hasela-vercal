import { PaymentError } from "./payment-types.ts";

export type CallbackStage = "method" | "content_type" | "body" | "outer_json" | "envelope" | "result_json" | "correlation";
export type CallbackReason = "unsupported" | "too_large" | "unreadable" | "malformed" | "missing_or_duplicate" | "payment_mismatch" | "confirmation_mismatch" | "transaction_mismatch";
type ContentType = "application/json" | "application/x-www-form-urlencoded" | "missing" | "unsupported";
const knownFields = ["result", "ResultData", "ConfirmationKey", "PelecardTransactionId", "TransactionId", "PelecardStatusCode", "StatusCode"] as const;
type ShapePath = "body" | "result" | `${"body" | "result" | "result.ResultData"}.${typeof knownFields[number]}`;
type ShapeType = "null" | "array" | "object" | "string" | "number" | "boolean";
interface ShapeEntry { path: ShapePath; type: ShapeType }
export interface CallbackDiagnostic {
  stage: CallbackStage;
  reason: CallbackReason;
  errorCode: "invalid_input" | "forged_callback";
  contentType: ContentType;
  shape: ShapeEntry[];
  confirmationPresent: boolean;
  confirmationIsString: boolean;
  transactionPresent: boolean;
  transactionIsString: boolean;
}
export class ControlledLiveCallbackError extends PaymentError {
  readonly diagnostic: CallbackDiagnostic;
  constructor(stage: CallbackStage, reason: CallbackReason, fields?: Partial<CallbackDiagnostic>) {
    super(stage === "correlation" ? "forged_callback" : "invalid_input");
    this.diagnostic = {
      stage, reason,
      errorCode: stage === "correlation" ? "forged_callback" : "invalid_input",
      contentType: fields?.contentType ?? "missing",
      shape: fields?.shape ?? [],
      confirmationPresent: fields?.confirmationPresent === true,
      confirmationIsString: fields?.confirmationIsString === true,
      transactionPresent: fields?.transactionPresent === true,
      transactionIsString: fields?.transactionIsString === true,
    };
  }
}
function shapeType(value: unknown): ShapeType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value as ShapeType; // Only JSON values or form strings enter here.
}
function summarize(value: unknown, prefix: "body" | "result", shape: ShapeEntry[]): void {
  shape.push({ path: prefix, type: shapeType(value) });
  const record = object(value);
  if (!record) return;
  for (const field of knownFields) {
    if (Object.hasOwn(record, field)) shape.push({ path: `${prefix}.${field}`, type: shapeType(record[field]) });
  }
  // Inspect only the one known ResultData nesting level. Arbitrary keys are
  // never visited or copied into diagnostics.
  const nested = prefix === "result" ? object(record.ResultData) : null;
  if (nested) for (const field of knownFields) {
    if (Object.hasOwn(nested, field)) shape.push({ path: `result.ResultData.${field}`, type: shapeType(nested[field]) });
  }
}
function fail(stage: CallbackStage, reason: CallbackReason, fields?: Partial<CallbackDiagnostic>): never {
  throw new ControlledLiveCallbackError(stage, reason, fields);
}
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
async function boundedBody(request: Request): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > 32768) { await reader.cancel(); fail("body", "too_large"); }
      parts.push(next.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    if (error instanceof ControlledLiveCallbackError) throw error;
    return fail("body", "unreadable");
  } finally { reader.releaseLock(); }
}
/** The configured result field contains JSON. Live Pelecard callbacks also
 * place correlation values in its ResultData object. Only the stored session
 * values are accepted; the subsequent provider lookup establishes approval.
 */
export async function parseControlledLiveCallback(request: Request, expected: {
  paymentId: string; transactionId: string; confirmationKey: string;
}): Promise<void> {
  const media = (request.headers.get("Content-Type") ?? "").split(";", 1)[0].trim().toLowerCase();
  const contentType: ContentType = !media ? "missing" : media === "application/json" || media === "application/x-www-form-urlencoded" ? media : "unsupported";
  const shape: ShapeEntry[] = [];
  try {
    await parseCallback(request, expected, shape);
  } catch (error) {
    if (error instanceof ControlledLiveCallbackError) {
      throw new ControlledLiveCallbackError(error.diagnostic.stage, error.diagnostic.reason, { ...error.diagnostic, contentType, shape });
    }
    throw error;
  }
}
async function parseCallback(request: Request, expected: {
  paymentId: string; transactionId: string; confirmationKey: string;
}, shape: ShapeEntry[]): Promise<void> {
  if (request.method !== "POST") fail("method", "unsupported");
  const ids = new URL(request.url).searchParams.getAll("paymentId");
  if (ids.length !== 1 || ids[0] !== expected.paymentId) fail("correlation", "payment_mismatch");
  const type = (request.headers.get("Content-Type") ?? "").split(";", 1)[0].trim().toLowerCase();
  if (type !== "application/json" && type !== "application/x-www-form-urlencoded") fail("content_type", "unsupported");
  const body = await boundedBody(request);
  let result: unknown;
  // Pelecard documents both a named form field and a raw JSON body. The
  // latter may still carry the default form content type.
  if (type === "application/json" || body.trimStart().startsWith("{")) {
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { fail("outer_json", "malformed"); }
    summarize(parsed, "body", shape);
    const envelope = object(parsed);
    if (!envelope) fail("envelope", "malformed");
    result = Object.hasOwn(envelope, "result") ? envelope.result : envelope;
  } else {
    const form = new URLSearchParams(body);
    // Fixed names only; never Object.fromEntries(form), which could retain
    // attacker-controlled field names in diagnostic state.
    const formShape: Record<string, string> = {};
    for (const field of knownFields) if (form.has(field)) formShape[field] = "";
    summarize(formShape, "body", shape);
    const values = form.getAll("result");
    if (values.length !== 1) fail("envelope", "missing_or_duplicate");
    result = values[0];
  }
  let parsed: unknown;
  if (typeof result === "string") {
    try { parsed = JSON.parse(result); } catch { fail("result_json", "malformed"); }
  } else parsed = result;
  summarize(parsed, "result", shape);
  const notice = object(parsed);
  if (!notice) fail("result_json", "malformed");
  const nested = object(notice.ResultData);
  const confirmation = nested ? nested.ConfirmationKey : notice.ConfirmationKey;
  const transaction = nested ? nested.TransactionId : notice.PelecardTransactionId;
  const fields = {
    confirmationPresent: confirmation !== undefined,
    confirmationIsString: typeof confirmation === "string",
    transactionPresent: transaction !== undefined,
    transactionIsString: typeof transaction === "string",
  };
  if (nested && Object.hasOwn(notice, "ConfirmationKey") &&
      notice.ConfirmationKey !== nested.ConfirmationKey)
    fail("correlation", "confirmation_mismatch", fields);
  if (nested && Object.hasOwn(notice, "PelecardTransactionId") &&
      notice.PelecardTransactionId !== nested.TransactionId)
    fail("correlation", "transaction_mismatch", fields);
  if (!expected.confirmationKey || confirmation !== expected.confirmationKey)
    fail("correlation", "confirmation_mismatch", fields);
  if (!expected.transactionId || transaction !== expected.transactionId)
    fail("correlation", "transaction_mismatch", fields);
}
