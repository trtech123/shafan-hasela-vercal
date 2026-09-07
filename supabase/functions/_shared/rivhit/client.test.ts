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
});
