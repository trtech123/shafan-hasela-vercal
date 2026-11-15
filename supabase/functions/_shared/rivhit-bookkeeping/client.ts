export class JournalOutcomeUnknown extends Error {
  constructor() { super("journal_outcome_unknown"); }
}
export interface AddJournalRequest {
  year: number;
  month: number;
  sort_code: number;
  customer_id_debit: number;
  customer_id_credit: number;
  reference_date: string;
  amount: number;
  reference1: string;
  reference2: string;
  currency_id: number;
  request_reference: string;
}

export interface JournalIdentity { year: number; month: number; line: number }

const url = "https://api.rivhit.co.il/online/RivhitOnlineAPI.svc/Accounting.AddJournal";

export function createJournalClient(options: {
  apiToken: string; enabled: boolean; fetchImpl?: typeof fetch;
}) {
  return {
    async addJournal(request: AddJournalRequest): Promise<JournalIdentity> {
      if (!options.enabled) throw new Error("journal_dispatch_disabled");
      if (!options.apiToken || !request.request_reference?.trim()
        || !Number.isSafeInteger(request.year) || request.year < 2000
        || !Number.isSafeInteger(request.sort_code) || request.sort_code <= 0
        || !Number.isSafeInteger(request.customer_id_debit) || request.customer_id_debit <= 0
        || !Number.isSafeInteger(request.customer_id_credit) || request.customer_id_credit <= 0
        || !Number.isSafeInteger(request.currency_id) || request.currency_id <= 0
        || !/^\d{2}\/\d{2}\/\d{4}$/.test(request.reference_date)
        || !Number.isSafeInteger(request.month)
        || request.month < 1 || request.month > 12 || !Number.isFinite(request.amount)
        || request.amount <= 0) throw new Error("invalid_journal_request");
      const payload = {
        year: request.year, month: request.month, sort_code: request.sort_code,
        customer_id_debit: request.customer_id_debit,
        customer_id_credit: request.customer_id_credit,
        reference_date: request.reference_date, amount: request.amount,
        reference1: request.reference1, reference2: request.reference2,
        currency_id: request.currency_id,
        request_reference: request.request_reference,
        api_token: options.apiToken,
      };
      let response: Response;
      try {
        response = await (options.fetchImpl ?? fetch)(url, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          redirect: "error", signal: AbortSignal.timeout(20_000),
        });
      } catch { throw new JournalOutcomeUnknown(); }
      let body: unknown;
      try { body = await response.json(); } catch { throw new JournalOutcomeUnknown(); }
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new JournalOutcomeUnknown();
      const result = body as Record<string, unknown>;
      if (typeof result.error_code !== "number") throw new JournalOutcomeUnknown();
      if (result.error_code !== 0) throw new JournalOutcomeUnknown();
      if (!response.ok || !result.data || typeof result.data !== "object"
        || Array.isArray(result.data)) throw new JournalOutcomeUnknown();
      const data = result.data as Record<string, unknown>;
      if (![data.year, data.month, data.line].every(v => Number.isSafeInteger(v) && Number(v) > 0))
        throw new JournalOutcomeUnknown();
      return { year: data.year as number, month: data.month as number, line: data.line as number };
    },
  };
}
