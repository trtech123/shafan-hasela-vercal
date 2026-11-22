export type AccountingStatus =
  | "pending"
  | "processing"
  | "succeeded"
  | "retryable_error"
  | "permanent_error"
  | "reconciliation_required";

export interface DocumentMapping {
  document_type: number;
  sort_code: number;
  currency_id: number;
  currency_code?: string;
  price_include_vat: boolean;
  send_mail: boolean;
  digital_signature: boolean;
}

export interface OrderSource {
  id: string;
  order_number?: string | null;
  client_name: string;
  client_phone?: string | null;
  client_email?: string | null;
  organization?: string | null;
  billing_institution_name?: string | null;
  billing_company_id?: string | null;
  billing_accounting_email?: string | null;
  num_participants?: number | null;
  price_per_person?: number | string | null;
  total_price?: number | string | null;
}

export interface RivhitCustomerDraft {
  last_name: string;
  email?: string;
  phone?: string;
  acc_ref: string;
  request_reference: string;
}

export interface RivhitDocumentDraft {
  document_type: number;
  customer_id: number;
  last_name: string;
  order?: string;
  comments?: string;
  sort_code: number;
  price_include_vat: boolean;
  currency_id: number;
  language: "he" | "en";
  email_to?: string;
  digital_signature: boolean;
  items: Array<{
    item_id: number;
    quantity: number;
    price_nis: number;
    description: string;
  }>;
  request_reference: string;
  prevent_duplicates: true;
  create_items: false;
  no_update_inventory: true;
  send_mail: boolean;
}

export interface MappedAccountingSource {
  provider: "rivhit";
  accountNamespace: string;
  sourceType: "order" | "payment_transaction";
  sourceId: string;
  documentTypeKey: string;
  identityKey: string;
  externalCustomerReference: string;
  customerRequestReference: string;
  documentRequestReference: string;
  payloadHash: string;
  customer: RivhitCustomerDraft;
  document: Omit<RivhitDocumentDraft, "customer_id">;
}

export interface RivhitCustomerResult {
  customerId: string;
}

export interface RivhitDocumentResult {
  customerId: string;
  documentType: number;
  documentId: string;
  documentNumber: string;
  documentUrl: string;
  amount: number | null;
}

export interface RivhitJournalDraft {
  sort_code: number;
  customer_id_debit: number;
  customer_id_credit?: number;
  amount: number;
  request_reference: string;
  year?: number;
  month?: number;
  reference_date?: string;
  due_date?: string;
  reference1?: string;
  reference2?: string;
  details?: string;
  currency_id?: number;
  foreign_amount?: number;
  exchange_rate?: number;
  project_id?: number;
  id_number?: number;
  shaam_invoice?: number;
}

export interface RivhitJournalResult {
  year: number;
  month: number;
  line: number;
}

export interface RivhitJournalReportRow {
  journal_id: number;
  journal_year: number;
  journal_month: number;
  debit_customer_id: number;
  credit_customer_id: number | null;
  sort_code: number;
  reference1: string | null;
  reference2: string | null;
  reference_date: string | null;
  total_amount: number;
  total_vat: number | null;
  total_without_vat: number | null;
}
