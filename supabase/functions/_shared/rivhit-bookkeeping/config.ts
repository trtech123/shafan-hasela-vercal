export interface JournalMapping {
  approved: true;
  approvalRef: string;
  version: string;
  accountNamespace: string;
  legs: Array<{ kind: string; sortCode: number; debitAccount: number;
    creditAccount: number; currencyId: number }>;
}

export interface JournalEnvironment {
  RIVHIT_JOURNAL_ENABLED?: string;
  RIVHIT_JOURNAL_MAPPING_JSON?: string;
}

function positiveInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

export function readJournalConfiguration(env: JournalEnvironment):
  { enabled: false; mapping: null } | { enabled: true; mapping: JournalMapping } {
  const disabled = { enabled: false as const, mapping: null };
  if (env.RIVHIT_JOURNAL_ENABLED !== "true" || !env.RIVHIT_JOURNAL_MAPPING_JSON) return disabled;
  try {
    const mapping: unknown = JSON.parse(env.RIVHIT_JOURNAL_MAPPING_JSON);
    if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) return disabled;
    const m = mapping as Record<string, unknown>;
    if (m.approved !== true || typeof m.approvalRef !== "string" || !m.approvalRef.trim()
      || typeof m.version !== "string" || !m.version.trim()
      || typeof m.accountNamespace !== "string" || !m.accountNamespace.trim()
      || !Array.isArray(m.legs) || m.legs.length === 0
      || !m.legs.every((item: unknown) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return false;
        const leg = item as Record<string, unknown>;
        return typeof leg.kind === "string" && Boolean(leg.kind.trim())
          && positiveInteger(leg.sortCode) && positiveInteger(leg.debitAccount)
          && positiveInteger(leg.creditAccount) && positiveInteger(leg.currencyId);
      })) return disabled;
    return { enabled: true, mapping: m as unknown as JournalMapping };
  } catch { return disabled; }
}
