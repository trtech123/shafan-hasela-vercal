import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.0";
import { PaymentError } from "./payment-types.ts";
import type { TestPaymentStore, TestPaymentRow } from "./pelecard-test-handler.ts";

export function createPelecardTestStore(client: SupabaseClient, transport: "edge" | "node_v1" = "edge"): TestPaymentStore {
  const table = "pelecard_test_payments";
  return {
    async get(id) {
      const { data, error } = await client.from(table).select("id,status,amount_minor,confirmation_key,redirect_url,provider_transaction_id,init_quarantined_at").eq("id", id).maybeSingle();
      if (error) throw new PaymentError("provider_unavailable");
      if (data?.init_quarantined_at) return { ...data, status: "test_quarantined" } as TestPaymentRow;
      return data as TestPaymentRow | null;
    },
    async reserve(id, actorId) {
      const { error } = await client.from(table).insert({ id, created_by: actorId, ...(transport === "node_v1" ? { init_transport: "node_v1" } : {}) });
      if (error?.code === "23505") return false;
      if (error) throw new PaymentError("provider_unavailable");
      return true;
    },
    async initiated(id, session) {
      const { data, error } = await client.from(table).update({ status: "pending", redirect_url: session.redirectUrl, confirmation_key: session.confirmationKey }).eq("id", id).eq("status", "initiating").select("id").maybeSingle();
      if (error || !data) throw new PaymentError("provider_unavailable");
    },
    async verified(id, evidence) {
      const { data, error } = await client.from(table).update({
        status: "test_verified", provider_transaction_id: evidence.transactionId,
        api_status: evidence.apiStatus, transaction_status: evidence.transactionStatus,
        verified_at: new Date().toISOString(),
      }).eq("id", id).eq("status", "pending").select("id").maybeSingle();
      if (error) throw new PaymentError("provider_unavailable");
      if (!data) {
        const { data: existing, error: readError } = await client.from(table).select("status,provider_transaction_id").eq("id", id).single();
        if (readError || existing?.status !== "test_verified" || existing?.provider_transaction_id !== evidence.transactionId) throw new PaymentError("provider_mismatch");
      }
    },
  };
}
