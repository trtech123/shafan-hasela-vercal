# Coffee voucher release group — 2026-11-18

This isolated branch starts from operational restoration commit `7614fa6dc9a991efeb18319e7358e6265e5f5ee5`. It adds order-linked voucher creation, administrator register setup, voucher list/filtering, and a downloadable informational report. It does not add automatic voucher email or accounting-document issuance. The report explicitly says it is not an accounting document or proof of payment. Protected cash, hosted Pelecard, Direct J4, Payper and order-payment routes remain unchanged.

Read-only production inspection confirmed `create_hakafa_voucher(uuid,jsonb)` and `save_cash_register(text,text,boolean)` exist as SECURITY DEFINER RPCs executable by authenticated users. The `hakafa_vouchers` and `cash_registers` tables have staff SELECT policies for admin/operations/cashier. Their internal RPC authorization and business rules remain authoritative; this structural check does not prove a successful live voucher. Local schema rehearsal includes voucher idempotency and unique order association.

The client uses an order-linked customer snapshot, explicit register choice, bounded service/contact fields, and a signature. The save has a fixed request UUID. On timeout or lost response it reads the existing order voucher and does not issue another create call. The report reads saved voucher snapshots and caps output at 500 entries. No voucher or accounting document was generated in Production.

Local verification: six focused voucher/signature/cashier files passed 19/19 tests, ESLint passed, and the production Vite build passed. An extracted generic PDF helper is included locally so voucher reporting does not depend on the quotation-delivery release group.

**Release gate:** NO-GO for Production voucher creation until the business owner confirms the voucher's accounting/document treatment and a controlled nonfinancial acceptance procedure. The live `save_cash_register` and voucher RPC bodies should receive a final role/business-rule comparison before release. No migration is proposed or applied here.
