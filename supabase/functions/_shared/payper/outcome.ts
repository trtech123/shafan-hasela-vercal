/** Classifies a response only after dispatch may have reached the provider. */
export type PayperDispatchResult =
  | { kind: "transport_error" }
  | { kind: "response"; body: unknown };

export type PayperDispatchOutcome =
  | { state: "succeeded"; documentNumber: string; documentUrl: string; automaticRetryAllowed: false }
  | { state: "reconciliation_required"; automaticRetryAllowed: false; safeCode?: string };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function documentedDocumentUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && (url.hostname === "payper.co.il" || url.hostname === "app.payper.co.il");
  } catch {
    return false;
  }
}

export function classifyDispatchedPayperOutcome(result: PayperDispatchResult): PayperDispatchOutcome {
  if (result.kind !== "response") return { state: "reconciliation_required", automaticRetryAllowed: false };
  const body = record(result.body);
  const data = record(body?.PayperData);
  if (body?.StatusCode === "000" && data?.InvoiceStatus === "Success"
    && typeof data.InvoiceNumber === "string" && /^[0-9]+$/.test(data.InvoiceNumber)
    && documentedDocumentUrl(data.InvoiceLink)) {
    return {
      state: "succeeded", documentNumber: data.InvoiceNumber,
      documentUrl: data.InvoiceLink, automaticRetryAllowed: false,
    };
  }
  return { state: "reconciliation_required", automaticRetryAllowed: false };
}
