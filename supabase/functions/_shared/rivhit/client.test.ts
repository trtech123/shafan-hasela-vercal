import { describe, expect, test, vi } from "vitest";
import { RivhitClient, RivhitError } from "./client.ts";

const token = "server-only-test-token";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("RivhitClient", () => {
  test("submits one journal with a server token and keeps the returned year, month and line", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      error_code: 0, data: { year: 2026, month: 11, line: 42 },
    }));
    const client = new RivhitClient({ apiToken: token, fetchImpl });
    const draft = {
      sort_code: 1, customer_id_debit: 100, customer_id_credit: 200,
      amount: 4, reference_date: "08112026", reference1: "200002", reference2: "RCP-1026",
      request_reference: "payper:200002:journal:1",
    };

    await expect(client.addJournal(draft)).resolves.toEqual({ year: 2026, month: 11, line: 42 });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.rivhit.co.il/online/RivhitOnlineAPI.svc/Accounting.AddJournal");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ api_token: token, ...draft });
  });

  test("treats a lost journal response as uncertain and never retries it inside the client", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("connection dropped"));
    const client = new RivhitClient({ apiToken: token, fetchImpl });

    await expect(client.addJournal({
      sort_code: 1, customer_id_debit: 100, customer_id_credit: 200,
      amount: 4, request_reference: "payper:200002:journal:1",
      reference_date: "08112026", reference1: "200002", reference2: "RCP-1026",
    })).rejects.toMatchObject({ reconciliationRequired: true, retryable: false });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  test("does not allow a journal draft to override the configured API token", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      error_code: 0, data: { year: 2026, month: 11, line: 42 },
    }));
    const client = new RivhitClient({ apiToken: token, fetchImpl });
    await client.addJournal({
      sort_code: 1, customer_id_debit: 100, customer_id_credit: 200,
      amount: 4, request_reference: "payper:200002:journal:1",
      reference_date: "08112026", reference1: "200002", reference2: "RCP-1026",
      api_token: "untrusted-value",
    } as Parameters<RivhitClient["addJournal"]>[0]);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).api_token).toBe(token);
  });

  test("reads journal reports without posting and preserves reference and amount evidence", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      error_code: 0, data: { journals_report: [{
        journal_id: 55, journal_year: 2026, journal_month: 11,
        debit_customer_id: 100, credit_customer_id: 200, sort_code: 1,
        reference1: "200002", reference2: "RCP-1026", reference_date: "08112026",
        total_amount: 4, total_vat: 0.61, total_without_vat: 3.39,
      }] },
    }));
    const client = new RivhitClient({ apiToken: token, fetchImpl });

    await expect(client.journalsReport("08112026")).resolves.toEqual([expect.objectContaining({
      journal_id: 55, reference1: "200002", total_amount: 4,
    })]);
    expect(fetchImpl.mock.calls[0][0]).toContain("Accounting.JournalsReport");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ api_token: token, date: "08112026" });
  });
  test("finds a customer by acc_ref", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      error_code: 0,
      client_message: "",
      debug_message: "",
      data: { customer_id: 1234 },
    }));
    const client = new RivhitClient({ apiToken: token, fetchImpl });

    await expect(client.findCustomerByAccRef("shabc")).resolves.toEqual({ customerId: "1234" });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      api_token: token,
      acc_ref: "shabc",
    });
  });

  test("returns null when Customer.Get reports no data", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      error_code: -2,
      client_message: "לא נמצאו נתונים",
      debug_message: "-2 : NO_DATA_FOUND",
      data: null,
    }, 500));
    const client = new RivhitClient({ apiToken: token, fetchImpl });

    await expect(client.findCustomerByAccRef("missing")).resolves.toBeNull();
  });

  test("creates a customer and returns its identifier", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      error_code: 0,
      data: { customer_id: 991128317 },
    }));
    const client = new RivhitClient({ apiToken: token, fetchImpl });

    await expect(client.createCustomer({
      last_name: "Sandbox Customer",
      acc_ref: "shabc",
      request_reference: "customer-ref",
    })).resolves.toEqual({ customerId: "991128317" });
    expect(fetchImpl.mock.calls[0][0]).toContain("Customer.New");
  });

  test.each([-20, -22])(
    "returns null when Customer.Get reports CUSTOMER_NOT_EXISTS (%s)",
    async (errorCode) => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
        error_code: errorCode,
        client_message: "customer not found",
        debug_message: `${errorCode} : CUSTOMER_NOT_EXISTS`,
        data: null,
      }, 500));
      const client = new RivhitClient({ apiToken: token, fetchImpl });

      await expect(client.findCustomerByAccRef("missing")).resolves.toBeNull();
    },
  );

  test("handles the sandbox Customer.Get not-found envelope", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      error_code: 500,
      client_message: "customer not found",
      debug_message: "-22 : CUSTOMER_NOT_EXISTS",
      data: null,
    }));
    const client = new RivhitClient({ apiToken: token, fetchImpl });

    await expect(client.findCustomerByAccRef("missing")).resolves.toBeNull();
  });

  test("creates a document and validates all persisted result fields", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      error_code: 0,
      data: {
        document_type: 1,
        document_number: 42,
        customer_id: 1234,
        document_identity: "1627aea5-8e0a-4371-9022-9b504344e724",
        document_link: "https://api.rivhit.co.il/pdf/test",
        amount: 10,
      },
    }));
    const client = new RivhitClient({ apiToken: token, fetchImpl });

    await expect(client.createDocument({
      document_type: 1,
      customer_id: 1234,
      last_name: "Sandbox Customer",
      items: [],
      request_reference: "document-ref",
      prevent_duplicates: true,
    })).resolves.toEqual({
      customerId: "1234",
      documentType: 1,
      documentId: "1627aea5-8e0a-4371-9022-9b504344e724",
      documentNumber: "42",
      documentUrl: "https://api.rivhit.co.il/pdf/test",
      amount: 10,
    });
    expect(fetchImpl.mock.calls[0][0]).toContain("Document.New");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).api_token).toBe(token);
  });

  test("classifies network and throttling failures as retryable without leaking the token", async () => {
    const networkClient = new RivhitClient({
      apiToken: token,
      fetchImpl: vi.fn().mockRejectedValue(new Error(`failed ${token}`)),
    });
    const throttledClient = new RivhitClient({
      apiToken: token,
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse({ error: "slow down" }, 429)),
    });

    const errors = [];
    for (const client of [networkClient, throttledClient]) {
      try {
        await client.findCustomerByAccRef("shabc");
      } catch (error) {
        errors.push(error);
      }
    }
    expect(errors).toHaveLength(2);
    for (const error of errors) {
      expect(error).toBeInstanceOf(RivhitError);
      expect((error as RivhitError).retryable).toBe(true);
      expect(String(error)).not.toContain(token);
    }
  });

  test("treats transient HTTP status as retryable when error_code is zero", async () => {
    const client = new RivhitClient({
      apiToken: token,
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse({ error_code: 0 }, 503)),
    });

    await expect(client.findCustomerByAccRef("shabc")).rejects.toMatchObject({
      retryable: true,
      httpStatus: 503,
    });
  });

  test("treats transient HTTP status with an unknown negative code as retryable", async () => {
    const client = new RivhitClient({
      apiToken: token,
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse({
        error_code: -54321,
        debug_message: "unknown provider failure",
      }, 503)),
    });

    await expect(client.findCustomerByAccRef("shabc")).rejects.toMatchObject({
      retryable: true,
      errorCode: -54321,
      httpStatus: 503,
    });
  });

  test("adds a request timeout signal", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      error_code: 0,
      data: { customer_id: 1234 },
    }));
    const client = new RivhitClient({ apiToken: token, fetchImpl, timeoutMs: 1234 });

    await client.findCustomerByAccRef("shabc");

    expect(fetchImpl.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  test("classifies structured validation and duplicate errors safely", async () => {
    const validationClient = new RivhitClient({
      apiToken: token,
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse({
        error_code: -28,
        client_message: "invalid id",
        debug_message: "-28 : INVALID_ID_NUMBER",
        data: null,
      }, 500)),
    });
    const duplicateClient = new RivhitClient({
      apiToken: token,
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse({
        error_code: -107,
        client_message: "already processed",
        debug_message: "-107 : REQUEST_ALREADY_PROCESSED",
        data: null,
      }, 500)),
    });

    await expect(validationClient.createCustomer({
      last_name: "x",
      acc_ref: "x",
      request_reference: "x",
    })).rejects.toMatchObject({ retryable: false, reconciliationRequired: false, errorCode: -28 });
    await expect(duplicateClient.createDocument({
      document_type: 1,
      customer_id: 1,
      last_name: "x",
      items: [],
      request_reference: "x",
      prevent_duplicates: true,
    })).rejects.toMatchObject({ retryable: false, reconciliationRequired: true, errorCode: -107 });
  });

  test.each([
    ["not-json", "Rivhit returned an invalid JSON response"],
    [JSON.stringify({ error_code: 0, data: { customer_id: 1 } }), "Rivhit document response is missing required fields"],
  ])("rejects invalid document response: %s", async (body, message) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(body, { status: 200 }));
    const client = new RivhitClient({ apiToken: token, fetchImpl });

    await expect(client.createDocument({
      document_type: 1,
      customer_id: 1,
      last_name: "x",
      items: [],
      request_reference: "x",
      prevent_duplicates: true,
    })).rejects.toThrow(message);
  });

  test.each([
    "not-json",
    JSON.stringify({ error_code: 0, data: { customer_id: 1 } }),
  ])("marks ambiguous successful Document.New responses for reconciliation", async (body) => {
    const client = new RivhitClient({
      apiToken: token,
      fetchImpl: vi.fn().mockResolvedValue(new Response(body, { status: 200 })),
    });

    await expect(client.createDocument({
      document_type: 1,
      customer_id: 1,
      last_name: "x",
      items: [],
      request_reference: "x",
      prevent_duplicates: true,
    })).rejects.toMatchObject({ reconciliationRequired: true });
  });

  test("rejects a negative journal amount before contacting Rivhit", async () => {
    const fetchImpl = vi.fn();
    const client = new RivhitClient({ apiToken: token, fetchImpl });
    await expect(client.addJournal({
      sort_code: 1, customer_id_debit: 100, amount: -4,
      request_reference: "negative-test",
    })).rejects.toThrow("Rivhit journal request is invalid");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test.each([
    { sort_code: 0, customer_id_debit: 100, amount: 4, request_reference: 'entry-1', reference1: '200002', reference2: 'RCP-1026', reference_date: '08112026' },
    { sort_code: 1, customer_id_debit: -2, amount: 4, request_reference: 'entry-1', reference1: '200002', reference2: 'RCP-1026', reference_date: '08112026' },
    { sort_code: 1, customer_id_debit: 100, amount: 4, request_reference: 'entry-1', reference1: '', reference2: 'RCP-1026', reference_date: '08112026' },
    { sort_code: 1, customer_id_debit: 100, amount: 4, request_reference: 'entry-1', reference1: '200002', reference2: 'RCP-1026', reference_date: '2026-11-08' },
  ])('rejects an uncorrelatable journal request before posting', async (draft) => {
    const fetchImpl = vi.fn();
    const client = new RivhitClient({ apiToken: token, fetchImpl });
    await expect(client.addJournal(draft)).rejects.toThrow('Rivhit journal request is invalid');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('accepts the existing Rivhit screen date style while preserving the supplied value', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      error_code: 0, data: { year: 2026, month: 11, line: 42 },
    }));
    const client = new RivhitClient({ apiToken: token, fetchImpl });
    await client.addJournal({
      sort_code: 1, customer_id_debit: 100, amount: 4,
      reference_date: '08/11/2026', reference1: '200002', reference2: 'RCP-1026',
      request_reference: 'entry-1',
    });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).reference_date).toBe('08/11/2026');
  });

  test("rejects malformed journal report rows before reconciliation", async () => {
    const client = new RivhitClient({ apiToken: token, fetchImpl: vi.fn().mockResolvedValue(jsonResponse({
      error_code: 0, data: { journals_report: [{ journal_id: 12, reference1: "200002" }] },
    })) });
    await expect(client.journalsReport("08112026")).rejects.toThrow("Rivhit journal report response is invalid");
  });

  test("reads the chart classification codes without a write operation", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      error_code: 0, data: [{ sort_code: 102, description: 'income' }],
    }));
    const client = new RivhitClient({ apiToken: token, fetchImpl });
    await expect(client.sortCodeList()).resolves.toEqual([{ sort_code: 102, description: 'income' }]);
    expect(fetchImpl.mock.calls[0][0]).toContain('Accounting.SortCodeList');
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).documents_only).toBe(false);
  });

  test("reads projects and payment types with only documented read operations", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error_code: 0, data: { project_list: [{ project_id: 5, project_name: 'Test project' }] } }))
      .mockResolvedValueOnce(jsonResponse({ error_code: 0, data: { payment_type_list: [{ payment_type: 2, payment_name: 'Cash', type_code: 1 }] } }));
    const client = new RivhitClient({ apiToken: token, fetchImpl });
    await expect(client.projectList()).resolves.toEqual([{ project_id: 5, project_name: 'Test project' }]);
    await expect(client.paymentTypeList()).resolves.toEqual([{ payment_type: 2, payment_name: 'Cash', type_code: 1 }]);
    expect(fetchImpl.mock.calls.map(call => call[0])).toEqual([
      expect.stringContaining('Project.List'), expect.stringContaining('Payment.TypeList'),
    ]);
  });

  test("looks up an account id but returns no contact, identity or token fields", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error_code: 0, data: {
      customer_id: 1416, first_name: 'Revenue', last_name: 'Account', customer_type: 3,
      acc_ref: 'REF', project_id: 4, email: 'private@example.test', cc_token: 'secret',
    } }));
    const client = new RivhitClient({ apiToken: token, fetchImpl });
    await expect(client.accountCard(1416)).resolves.toEqual({
      account_id: 1416, name: 'Revenue Account', account_type: 3, project_id: 4,
    });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ customer_id: 1416, api_token: token });
    await expect(client.accountCard(0)).rejects.toThrow();
  });

  test("reads profit and loss account names without returning balances", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error_code: 0, data: {
      pnl_report: [{ account_id: 1416, account_name: 'Revenue', balance: 100,
        pnl_code: 2, pnl_name: 'Income' }],
    } }));
    const client = new RivhitClient({ apiToken: token, fetchImpl });
    await expect(client.profitLossAccounts(2026, 1, 11)).resolves.toEqual([{
      account_id: 1416, account_name: 'Revenue', pnl_code: 2, pnl_name: 'Income',
    }]);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      year: 2026, from_month: 1, to_month: 11, api_token: token,
    });
  });
});
