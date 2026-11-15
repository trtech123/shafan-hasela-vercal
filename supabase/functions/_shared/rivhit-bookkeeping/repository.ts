import type { AddJournalRequest, JournalIdentity } from "./client.ts";
import type { JournalRepository } from "./worker.ts";

interface RpcClient {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}

export function createJournalRepository(client: RpcClient, mapping: {
  version: string; approvalRef: string; accountNamespace: string;
}): JournalRepository {
  return {
    async claim(id: string) {
      const { data, error } = await client.rpc("claim_rivhit_bookkeeping_leg", {
        p_id: id, p_mapping_version: mapping.version,
        p_approval_ref: mapping.approvalRef,
        p_account_namespace: mapping.accountNamespace,
      });
      if (error) throw new Error("journal_claim_failed");
      if (!Array.isArray(data) || data.length === 0) return null;
      if (data.length !== 1 || !data[0]?.claim_token || !data[0]?.frozen_request)
        throw new Error("invalid_journal_claim");
      return { id: String(data[0].leg_id), token: String(data[0].claim_token),
        request: data[0].frozen_request as AddJournalRequest };
    },
    async complete(id: string, token: string, identity: JournalIdentity) {
      const { data, error } = await client.rpc("complete_rivhit_bookkeeping_leg", {
        p_id: id, p_claim_token: token, p_year: identity.year,
        p_month: identity.month, p_line: identity.line,
      });
      if (error || data !== true) throw new Error("journal_state_conflict");
    },
    async fail(id: string, token: string) {
      const { data, error } = await client.rpc("hold_rivhit_bookkeeping_leg", {
        p_id: id, p_claim_token: token, p_error_code: "unknown_outcome",
      });
      if (error || data !== true) throw new Error("journal_state_conflict");
    },
  };
}
