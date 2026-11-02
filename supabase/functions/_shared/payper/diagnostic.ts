interface PaymentRow {
  id: string; provider: string; operation: string; status: string; verified_at: string | null;
  provider_transaction_id: string | null; amount: string | number; currency: string;
}
interface ReadClient {
  from(table: string): { select(columns: string): { eq(column: string, value: string): {
    maybeSingle(): PromiseLike<{ data: PaymentRow | null; error: unknown }>;
  } } };
}

/** No reservation, ledger write, or invoice adapter is reachable from this diagnostic. */
export async function lookupVerifiedPayment(paymentId: string, client: ReadClient,
  provider: { lookupTransaction(hostedId: string, amountMinor: number): Promise<string> }) {
  const { data, error } = await client.from("payment_transactions")
    .select("id,provider,operation,status,verified_at,provider_transaction_id,amount,currency")
    .eq("id", paymentId).maybeSingle();
  const amount = Number(data?.amount);
  const amountMinor = Math.round(amount * 100);
  if (error || !data || data.id !== paymentId || data.provider !== "pelecard"
    || data.operation !== "payment" || data.status !== "succeeded" || !data.verified_at
    || !data.provider_transaction_id || data.currency !== "ILS" || !Number.isSafeInteger(amountMinor)
    || amountMinor <= 0 || Math.abs(amount * 100 - amountMinor) > 1e-7)
    throw new Error("diagnostic_payment_unavailable");
  const transactionRecordId = await provider.lookupTransaction(data.provider_transaction_id, amountMinor);
  return { verified: true, transactionRecordId };
}
