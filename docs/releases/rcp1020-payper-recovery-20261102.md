# RCP-1020: supervised Payper recovery

This is a reviewable procedure, not authorization to change production or issue a document.
No second card payment, sale, historical scan, or recurring schedule is part of it.

## Proven incident facts

- Payment `28b4786f-e722-40ae-9661-f3e805fc71bf` succeeded for ₪3 ILS. Sale `RCP-1020` is linked once. Pelecard reports transaction record `3175016155`.
- The frozen source contains one `טופי/סוכריות` at ₪3, regular VAT, and a valid private billing snapshot. The actual invoice builder accepted those facts in memory with synthetic credentials and `send_by_mail=true`.
- The installed Payper worker's `PELECARD_TERMINAL` differs from the live terminal shown in Pelecard reports. A read-only `PaymentGW/GetTransaction` using its installed credential set returned `StatusCode=501`, which Pelecard's official error lookup identifies as rejected user credentials. No `ResultData` transaction was returned.
- Ledger `source_blocked/pre_dispatch_review_required`; `dispatch_reserved_at`, `provider_trx_record_id`, document number and URL are null. Rivhit has zero attempts. Payper November income list has zero documents. No provider invoice request was sent by this worker.
- The existing UTC activation cutoff is `2026-11-02T19:36:28.512503+00:00`; it must remain unchanged. The canary target is this payment, allowance is one, and database dispatch is off.

## Disabled technical release

1. Deploy only `202611020003_payper_pre_dispatch_diagnostics.sql` to add allowlisted, durable pre-dispatch reasons and a service-role, admin-audited, one-time rearm function. This migration changes no existing ledger row or switch.
2. Deploy the reviewed `payper-issuance-worker` revision. Deploy the accounting UI revision from the branch based on production commit `dbd86f692946fd3a0253e3c635b543f237c55911`. Do not redeploy payment functions or unrelated application changes.
3. Keep POS initiation, Payper dispatch, auto wake, auto scan, and the recovery schedule off. Confirm no document was created before proceeding.
4. In Supabase's secret UI, set `PELECARD_TERMINAL`, `PELECARD_USER`, and `PELECARD_PASSWORD` to the verified production Pelecard API credential set used for the live payment terminal. Never paste values into a chat or log. A read-only `GetTransaction` for hosted ID `16d21808-3e50-4fa1-b866-89a379b6f645` must then return status `000`, the same hosted ID, record `3175016155`, `ShvaResult=000`, `DebitTotal=300`, `DebitCurrency=1`, and the original confirmation-key correlation. Any mismatch stops recovery.

## Separately authorized one-document recovery

1. Recheck Pelecard and Payper portals, payment/sale/billing snapshot, no accounting document, no immediate Rivhit dispatch, and ledger with no dispatch reservation. Retain evidence of these checks.
2. With a real admin actor through service-role execution, call `note_payper_reconciliation(payment_id, actor_id, '3175016155', safe_note)`. The note contains the read-only verification and no personal or credential data.
3. While database dispatch is still **off**, call `rearm_payper_source_after_reconciliation(payment_id, actor_id, '3175016155')`. It can only move this targeted, previously frozen source from `source_blocked` to `source_frozen` once; it preserves frozen facts and audit evidence. It cannot send an invoice.
4. Set worker `PAYPER_DISPATCH_ENABLED=true` and `PAYPER_SEND_BY_MAIL=true` while `PAYPER_AUTO_SCAN_ENABLED=false` and `PAYPER_AUTO_WAKE_ENABLED=false`. Keep POS initiation off and install no schedule. Verify worker authentication. As the final gate, set `payper_dispatch_control.enabled=true` only if mode is `canary`, target is this payment, allowance is exactly one and cutoff is unchanged.
5. Invoke the authenticated Payper worker **once**, targeting only payment `28b4786f-e722-40ae-9661-f3e805fc71bf` with the existing target header and no request body. The atomic reservation must persist record `3175016155` before any `CreatePayperInvoice` request. No second invocation follows an uncertain result.
6. Verify the ledger's document number and HTTPS link, Payper portal document, actual issue date, private legal identity, `טופי/סוכריות`, ₪3 VAT-inclusive amount, and email request. Delivery requires confirmation from the customer's mailbox or provider delivery evidence; `send_by_mail` alone is not delivery proof.
7. Immediately set database dispatch off, worker dispatch off, and mail option off. Confirm no schedule, no other reserved ledger row, and the final target state. If the provider outcome is uncertain, hold for manual reconciliation and do not retry.

Continuous processing requires a successful verified document, correction of the production credential set, a separate activation approval, future-only eligibility checks, auto wake and scheduled recovery verification, and administrator monitoring. The old UTC cutoff must never be backdated or reset.
