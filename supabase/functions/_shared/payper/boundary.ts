/** This boundary intentionally has no HTTP transport, credentials, or request mapper. */
export class DisabledPayperProvider {
  async createDocument(): Promise<never> {
    throw new Error("payper_dispatch_disabled");
  }
}

export type PayperLedgerState =
  | "eligible" | "source_frozen" | "source_blocked" | "dispatch_reserved"
  | "reconciliation_required" | "succeeded";

export type PayperLedgerAction = "freeze_source" | "reserve_dispatch" | "uncertain" | "confirmed_success";

const transitions: Partial<Record<PayperLedgerState, Partial<Record<PayperLedgerAction, PayperLedgerState>>>> = {
  eligible: { freeze_source: "source_frozen" },
  source_frozen: { reserve_dispatch: "dispatch_reserved" },
  dispatch_reserved: { uncertain: "reconciliation_required", confirmed_success: "succeeded" },
};

export function nextPayperLedgerState(state: PayperLedgerState, action: PayperLedgerAction): PayperLedgerState {
  const next = transitions[state]?.[action];
  if (!next) throw new Error("payper_transition_forbidden");
  return next;
}
