# Terminal 2: independent cash release and hosted EMV activation handoff

Terminal 1 owns production integration and deployment. Source work began from integrated `b243aac` and keeps digital checkout and continuous Payper configuration untouched. No production charge, Payper issuance, database migration, or deployment was performed by terminal 2.

## Cash can release independently

The deployed `payper-noncard-collection` Edge function already supports scheduled and standalone cash sales. This branch corrects its provider serialization against Services REST September 2026 printed pages 13 and 32–33: `typeDocument="Invoice-Receipt"`, `trxRecordId=""`, `Uid=""`, a frozen VAT-inclusive invoice line, `receipt_lines.payment_type="Cash"`, `amount` as an agorot string, actual payment date, verified billing identity/name/email, and `send_by_mail="true"`. The server reads `vatApplicable` from the immutable document ledger before dispatch and refuses a source that is not explicitly taxable. It preserves the one-shot dispatch reservation; a transport ambiguity remains a reconciliation hold, never a second issuance request. The SQL order collector charges the full outstanding balance for a cashier and refuses an existing document requiring review.

Cash is controlled by Supabase Edge secrets. After terminal 1 integrates and deploys the reviewed Edge function, keep `PAYPER_NONCARD_COLLECTION_ENABLED=false` and `PAYPER_CASH_DISPATCH_ENABLED=false` until the specifically approved genuine cash receipt. Keep `PAYPER_CHECK_DISPATCH_ENABLED=false` and `PAYPER_CHECK_DETAILS_CONTRACT_CONFIRMED=false`. After the accepted cash payment and official document are verified, set the cash collection and dispatch gates to `true` and leave them enabled for eligible orders and authorized staff. Keep digital checkout and continuous Payper secrets unchanged. No new cash migration is required; the prior non-card migrations are already applied.

The test customer will be entered in the application as **דניאל בדיקה**, with the user's verified billing ID and accounting email and a determined VAT treatment. Terminal 1's billing eligibility UI must save and validate these facts before the server permits collection. A separate genuine scheduled order must be selected for cash. Query its current outstanding balance and document history immediately before the test. The cashier receives the agreed full amount in cash, then invokes collection once with a fresh request key. Inspect one `payment_transactions` row (`manual_cash`, succeeded), one linked `sales` row, zero outstanding order balance, correct cash payment status, and exactly one `payper_document_ledger` succeeded row with official number and URL. Verify email delivery through mailbox/provider evidence. If the document response is uncertain, keep the payment and ledger hold, and reconcile; never send `CreatePayperInvoice` again.

## Physical hosted EMV architecture

The Hebrew IFrame20 manual printed pages 5–6 and 17 says `EmvPinpad=True` exposes a provider PINPAD button. Pages 26–27 show Payper parameters in the hosted initialization. The new implementation uses the serverless Vercel physical API. A cashier reserves the server-priced POS cart or existing order balance, opens one hosted session with `PaymentGW/init`, follows the returned provider URL, presses Pelecard's PINPAD button, and asks the customer to present the card at CT20 register `004`. The app never scripts the provider button. Hosted initialization does not charge a card.

The new `202611150004_physical_hosted_emv.sql` migration adds a route discriminator and hosted session fields to the existing physical intent, plus a physical document system ID on the Payper ledger. A new reservation trigger rejects missing or invalid billing identity, email, or VAT before any one-shot claim. It adds hosted initialization claim and persistence RPCs, read-only source/view RPCs, excludes hosted intents from the direct worker list, and adds an idempotent exact-payment document association RPC. It creates no transaction or invoice and does not change historical financial rows. Terminal 1 must review and report this exact scope before applying it; this file is **not applied** in production.

The Vercel callback treats incoming content solely as an untrusted notification. It ignores its claimed payment and invoice values, retrieves the frozen intent by UUID, calls `GetTransaction` over TLS, compares hosted transaction ID, confirmation key, currency, agorot, approval and UID, and checks register `004`, amount and terminal again through `GetTransDetailsEMV`. Only then does the existing physical finalizer create the payment/sale/order result. The provider's `PayperData` is read only from that authenticated `GetTransaction` response if present. `InvoiceStatus="000"`, a positive official number, valid Payper URL and optional numeric `document_system_id` allow the new ledger RPC to attach the already-issued document to that exact payment/sale/order. `RawResponse`, card data, credentials and signed document URLs are never logged. Duplicate callbacks and status checks cannot repeat initialization, financial dispatch or document issuance.

**Known provider limitation:** Services REST printed page 16 does not guarantee `GetTransaction` includes `PayperData` for every hosted EMV transaction. When payment is verified but that metadata is absent or rejected, the cashier sees a reconciliation warning. The app keeps the existing `source_blocked` physical ledger and pointer for read-only retry or the existing admin verified-document reconciliation RPC. It never calls `CreatePayperInvoice` for that physical payment. Email delivery requires separate proof. A successful document response is not delivery proof.

The hosted path runs on Vercel; it does not depend on the user's PC or the five-minute local worker. Keep the old direct J4 worker and `PELECARD_PHYSICAL_DISPATCH_ENABLED=false` as a disabled fallback. Do not run the local worker for hosted transactions. The documented hosted flow has an extra PINPAD button; Pelecard has not confirmed a supported one-click server trigger for this merchant.

## Physical configuration for a controlled production release

Apply the reviewed migration before enabling the Vercel flags. Configure these dedicated Vercel server values from the existing encrypted vault, never in Git or chat:

- `PELECARD_PHYSICAL_ENABLED=true`
- `PELECARD_PHYSICAL_USER`, `PELECARD_PHYSICAL_PASSWORD`, `PELECARD_PHYSICAL_TERMINAL`
- `PELECARD_PHYSICAL_DATABASE_URL`, `PELECARD_PHYSICAL_DATABASE_CA`
- `PELECARD_PHYSICAL_DISPATCH_ENABLED=false` (old direct J4 remains OFF)
- `PELECARD_PHYSICAL_HOSTED_ENABLED=true`
- `PELECARD_PHYSICAL_HOSTED_INIT_ENABLED=true` only in the approved test window, then permanently after acceptance
- `PELECARD_PHYSICAL_HOSTED_RETURN_URL=https://shafan-hasela-vercal.vercel.app/payment/physical`
- `PELECARD_PHYSICAL_HOSTED_CALLBACK_BASE=https://shafan-hasela-vercal.vercel.app/api/pelecard-physical-callback`
- `VITE_PELECARD_PHYSICAL_ENABLED=true` in the Vite build environment only after the UI and server are ready

Only register `004` may be enabled and assigned to the cashier workstation. Do not enable `003`, `005`, or `006`. Before activation, verify device assignment, dedicated database TLS connectivity, callback reachability, and that the old direct worker cannot claim hosted intents. The migration rehearsal passed against the full isolated 92-migration schema and a dedicated one-shot/document replay; these are not a production provider acceptance.

## Separate genuine CT20 acceptance

Terminal 1 and the user designate a **different** small scheduled order for physical card acceptance under **דניאל בדיקה**. The user enters verified billing identity/email in the application and selects an eligible VAT treatment. Read the order's current balance, linked customer, VAT, prior payments and documents; confirm no unresolved payment or document review. Record the exact order number, approved agorot, workstation, CT20 register `004`, cashier and test time in the release ticket. Obtain transaction-specific approval before the cashier presses the hosted PINPAD button or presents a card.

After approval, prepare one physical order intent, open the hosted page, press its provider PINPAD button, and present the card once. Use the callback or cashier's “check status” action to verify one provider transaction ID/UID, correct amount and register, one linked payment and sale, correct order balance/status, and one official Invoice-Receipt number/URL/system ID if supplied. Check the accounting email separately. Replay the callback and status request; counts must stay one. If document data is missing, keep the paid state and reconcile the already-issued document. Once the live charge, document and email checks pass, leave the hosted physical flags on for authorized staff; direct J4 remains off.

## Checks remain gated

The provider-facing receipt type is `Cheque`; the internal method remains `check`. Services REST printed page 33 omits structured keys for check number, bank, branch, account and due date. The received date is retained as the payment date and the later due date in the frozen check record, consistent with the accountant's Invoice-Receipt on receipt policy. Remarks alone are not verified as sufficient. Do not enable the check gates until Pelecard answers the provider questions in the earlier contract handoff and a complete check document is tested.
