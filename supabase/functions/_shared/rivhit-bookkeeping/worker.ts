import type { AddJournalRequest, JournalIdentity } from "./client.ts";

export interface JournalRepository {
  claim(id: string): Promise<{ id: string; token: string; request: AddJournalRequest } | null>;
  complete(id: string, token: string, identity: JournalIdentity): Promise<void>;
  fail(id: string, token: string): Promise<void>;
}

export async function processJournalLeg(options: {
  enabled: boolean;
  legId: string;
  repository: JournalRepository;
  client: { addJournal(request: AddJournalRequest): Promise<JournalIdentity> };
}): Promise<{ status: "configuration_required" | "not_claimed" | "succeeded"
  | "reconciliation_required" }> {
  if (!options.enabled) return { status: "configuration_required" };
  const leg = await options.repository.claim(options.legId);
  if (!leg) return { status: "not_claimed" };
  try {
    const identity = await options.client.addJournal(leg.request);
    await options.repository.complete(leg.id, leg.token, identity);
    return { status: "succeeded" };
  } catch {
    const status = "reconciliation_required";
    // An unknown dispatch or a failed local completion cannot authorize another POST.
    await options.repository.fail(leg.id, leg.token);
    return { status };
  }
}
