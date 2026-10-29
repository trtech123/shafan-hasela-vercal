import { buildCreatePayperInvoice, type FrozenPayperFacts,
  type GatewayCredentials, type CreatePayperInvoiceRequest } from "./provider.ts";
import type { PayperDispatchOutcome } from "./outcome.ts";
import { isPostActivationPayment } from "./cutoff.ts";

interface IssuanceLedger {
  freezeSource(paymentId: string): Promise<unknown>;
  reserveDispatch(paymentId: string): Promise<string>;
  recordOutcome(paymentId: string, outcome: PayperDispatchOutcome): Promise<void>;
}
interface IssuanceProvider {
  lookupTransaction(hostedId: string, amountMinor: number): Promise<string>;
  createInvoice(request: CreatePayperInvoiceRequest, reservationId: string): Promise<PayperDispatchOutcome>;
}

/** The only local path from frozen payment facts to the creation adapter. */
export async function issueFrozenPayperDocument(paymentId: string, options: {
  ledger: IssuanceLedger; provider: IssuanceProvider;
  credentials: GatewayCredentials;
}): Promise<PayperDispatchOutcome> {
  if (!paymentId) throw new Error("payper_payment_id_required");
  const facts = await options.ledger.freezeSource(paymentId) as FrozenPayperFacts;
  if (!facts || facts.paymentId !== paymentId || !Number.isSafeInteger(facts.amount * 100)
    || facts.amount <= 0) throw new Error("payper_frozen_source_invalid");
  if (!isPostActivationPayment(facts.paymentCreatedAt, facts.verifiedAt, facts.activationCutoffUtc))
    throw new Error("payper_activation_fence");
  const amountMinor = Math.round(facts.amount * 100);
  const recordId = await options.provider.lookupTransaction(facts.pelecardTransactionId, amountMinor);
  const request = buildCreatePayperInvoice(facts, recordId, options.credentials);
  // A future activation migration must enable this database RPC. Until then the
  // existing disabled ledger rejects here, before the document POST.
  const reservationId = await options.ledger.reserveDispatch(paymentId);
  let outcome: PayperDispatchOutcome;
  try {
    outcome = await options.provider.createInvoice(request, reservationId);
  } catch {
    outcome = { state: "reconciliation_required", automaticRetryAllowed: false };
  }
  await options.ledger.recordOutcome(paymentId, outcome);
  return outcome;
}
