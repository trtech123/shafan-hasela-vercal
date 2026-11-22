import { describe, expect, test } from "vitest";
import { prepareJournalSource } from "./source.ts";

const source = {
  cutoff: "2026-11-22T12:00:00Z",
  ledger: {
    id: "ledger-1", paymentId: "payment-1", saleId: "sale-1", orderId: "order-1",
    state: "succeeded", documentOrigin: "automatic",
    documentNumber: "200010", documentUrl: "https://app.payper.co.il/public/invoice_show/3554599?ak=opaque",
    updatedAt: "2026-11-22T12:05:00Z",
  },
  payment: {
    id: "payment-1", saleId: "sale-1", orderId: "order-1", status: "succeeded",
    provider: "pelecard", currency: "ILS",
    amount: 4, createdAt: "2026-11-22T12:01:00Z",
    verifiedAt: "2026-11-22T12:03:00Z",
  },
  sale: { id: "sale-1", total: 4, receiptNumber: "RCP-2000" },
};

describe("future Payper journal source", () => {
  test("admits one finalized linked document after the cutover without assigning accounts", () => {
    expect(prepareJournalSource(source)).toEqual({
      ledgerId: "ledger-1", paymentId: "payment-1", saleId: "sale-1",
      payperDocumentNumber: "200010", payperDocumentUrl: "https://app.payper.co.il/public/invoice_show/3554599?ak=opaque",
      receiptNumber: "RCP-2000", amountMinor: 400,
    });
  });

  test("rejects a document tied to a payment from before cutover", () => {
    expect(() => prepareJournalSource({
      ...source, payment: { ...source.payment, createdAt: "2026-11-21T12:00:00Z" },
    })).toThrow("journal_source_before_cutover");
  });

  test("rejects an issued document whose payment and sale amounts differ", () => {
    expect(() => prepareJournalSource({
      ...source, sale: { ...source.sale, total: 5 },
    })).toThrow("journal_source_mismatch");
  });

  test("rejects a Payper document linked to another order", () => {
    expect(() => prepareJournalSource({
      ...source, ledger: { ...source.ledger, orderId: 'other-order' },
    })).toThrow("journal_source_mismatch");
  });

  test("accepts a standalone POS document without an order link", () => {
    expect(prepareJournalSource({
      ...source, ledger: { ...source.ledger, orderId: null },
      payment: { ...source.payment, orderId: null },
    }).amountMinor).toBe(400);
  });

  test("rejects an uncertain document or payment without an official number", () => {
    expect(() => prepareJournalSource({
      ...source, ledger: { ...source.ledger, state: "reconciliation_required", documentNumber: null },
    })).toThrow("journal_source_unverified");
  });

  test("accepts a confirmed cash document only with its durable noncard evidence", () => {
    expect(prepareJournalSource({
      ...source,
      ledger: { ...source.ledger, sourceType: "manual_cash" },
      payment: { ...source.payment, provider: "manual_cash", verifiedAt: null },
      noncard: { paymentId: "payment-1", saleId: "sale-1", method: "cash", amountMinor: 400 },
    }).amountMinor).toBe(400);
  });

  test("rejects an uncorroborated cash or cheque document", () => {
    expect(() => prepareJournalSource({
      ...source,
      ledger: { ...source.ledger, sourceType: "manual_cash" },
      payment: { ...source.payment, provider: "manual_cash", verifiedAt: null },
    })).toThrow("journal_source_unverified");
  });

  test("rejects a document link outside Payper", () => {
    expect(() => prepareJournalSource({
      ...source, ledger: { ...source.ledger, documentUrl: 'https://example.invalid/fake-pdf' },
    })).toThrow('journal_source_unverified');
  });

  test("accepts an exact agorot amount despite binary floating-point representation", () => {
    expect(prepareJournalSource({
      ...source, payment: { ...source.payment, amount: 0.29 },
      sale: { ...source.sale, total: 0.29 },
    }).amountMinor).toBe(29);
  });

  test("rejects a source amount with fractional agorot", () => {
    expect(() => prepareJournalSource({
      ...source, payment: { ...source.payment, amount: 0.291 },
      sale: { ...source.sale, total: 0.291 },
    })).toThrow("journal_source_mismatch");
  });
});
