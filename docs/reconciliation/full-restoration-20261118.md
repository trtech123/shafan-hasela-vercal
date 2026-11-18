# Full functionality restoration candidate — 2026-11-18

## Source and release boundary

- Protected deployed application: `73690eee338b400bd9310e8fb283806852f43f29`, Vercel `dpl_AQKAKWDGJvcp1s2YokgBVs2xffeP` (READY at read-only inspection).
- This branch starts from the protected source through the customer-management candidate `c4ed2a6c4c90223b200953c1089c64c1b4c9e527`. It does **not** merge the older `main` tree.
- Existing POS, optional customer details, cash, hosted Pelecard, Direct J4, Payper, order scheduling, queue worker, Vercel deploy controls and financial gates are retained. No production deployment, migration, data mutation, payment, document issuance or customer communication was performed during integration.
- Local tests use synthetic records and mocked provider calls. Presence of a migration, RPC name, Edge Function, or environment variable is not proof of the deployed function's contract or live provider readiness.

## Restored candidate behavior

| Area | Candidate behavior | Activation dependency |
|---|---|---|
| Customer management | Search, create, edit, archive and role-gated navigation from the preceding customer candidate. | Existing customers RLS and archive RPC were observed in a read-only production schema check. Continue role-based acceptance before release. |
| Club attendance | Admin history and correction workspace, manual session creation, instructor attendance, explicit user-to-instructor links and navigation. Versioned correction RPCs are reused. | Read-only production check found the expected attendance tables/RPC names. Verify their exact signatures/RLS against the deployed schema. Instructor account creation also needs the separately deployed `create-user` Edge Function updated and authorized. No attendance migrations are replayed. |
| Order signatures | Public `/order-sign` page, private immutable revision API and PDF renderer, and staff signature controls in the current order confirmation overlay. The existing combined PDF, email and WhatsApp controls remain. | Verify exact deployed signing RPCs, private Storage bucket/policies, `send-order-signature` Edge version, `ORDER_SIGNATURE_PUBLIC_ORIGIN`, runtime packaging and live authorization before release. No customer link was issued. |
| Quotation delivery | Saved versioned quotations gain durable delivery history, capabilities, explicit resend confirmation and uncertain-result lock. Historical unversioned quotations retain the current PDF/send controls. | Verify `send-quote-email` and `send-quote-whatsapp` deployed versions and destination permissions. The candidate does not assume the Edge code equals the repository copy. |
| Order delivery | Existing production combined PDF/email/WhatsApp remains. The signing panel adds revisioned signed-order delivery. | Signed delivery requires the signing dependencies above. The older `OrderDeliveryPanel` was not transplanted because it overlaps the current order document and communication flow. |
| Coffee vouchers | Role-gated list, order-linked creation, explicit register/customer snapshot/signature, read-only report and duplicate/uncertain-result handling. A report is clearly labeled non-accounting. | Confirm the live `create_hakafa_voucher` contract, RLS and accounting policy before enabling creation. No automatic voucher email control was ported. |
| Pelecard administration | Admin-only read-only transaction retrieval UI using the protected server route and retrieval scope. | Verify the live retrieval gate value and scope; existence of env names alone does not mean it is enabled. No refund or mutation control was restored. |

## Deliberately pending

- **Private chatbot document delivery:** repository migrations and RPC names exist, but the current private asset uploads, Storage policies and deployed webhook bundle could not be verified. The historical main release note described an uncompleted deployment. Do not copy the old webhook over the current state machine or expose a document link until asset hashes, private authorization, at-most-once send behavior and live function version are confirmed.
- **Legacy iCredit TEST actions and old immediate accounting UI:** current production club screen still contains TEST actions. No new charge path or historical accounting UI is added. Removing the current TEST controls requires a business/financial UX decision; reintroducing legacy operations requires a verified provider need.
- **Payment-return continuity:** protected login/return and newer payment recovery flows remain authoritative. No older payment return module was ported without a proven missing behavior.
- **Provider-driven communication:** Edge functions are external deployments. No production send or accounting document can be treated as verified by local mock tests.

## Read-only dependency evidence and limits

- Supabase production metadata inspection found the expected groups of attendance (7/7), signing (5/5), vouchers (3/3), and chatbot (2/2) tables/RPC names. It did not prove every definition, policy or Storage object matches the repository; exact database contract review is a release gate.
- Supabase Edge dashboard listed `create-user`, `send-order-signature`, `send-order-doc`, `send-order-whatsapp`, `send-quote-email`, `send-quote-whatsapp`, `voucher-accounting-email` and `whatsapp-webhook` among 32 functions. Their deployed code versions were not confirmed.
- Vercel production project inspection reported the protected deployment READY. Environment **names** for signing, Supabase and Pelecard retrieval exist; their values and activation states were not read or modified.
- No new SQL migration is added by this candidate. All historical attendance, signature, quotation, voucher and chatbot migrations remain in the protected tree. An isolated PGlite full-schema rehearsal is required; it cannot replace a production contract audit.

## Integration and release order

1. Review the candidate diff against `73690eee`; verify the protected cashier/payment/Payper/J4/Vercel files have no unexpected changes.
2. Complete exact read-only production contract checks for attendance, customer, signatures, quotation delivery, vouchers and Storage. Verify Edge function source revisions and role/RLS permissions. Do not replay historical migrations.
3. Release non-financial customer and attendance UI first after authorization review. Deploy the `create-user` change in a separately controlled Edge release if instructor account creation is required. Test an authorized instructor link with synthetic/approved data.
4. Release signing only after private Storage, renderer packaging, public-origin configuration and Edge delivery verification. Do a protected Preview/mobile acceptance before any live signature link.
5. Release quotation delivery and vouchers only after provider/accounting and Edge contract acceptance. Enable and test each communication channel under a separate controlled plan. Keep chatbot private documents pending its asset/webhook security review.
6. Keep `main` unchanged until a new candidate is accepted and deployed. Reconcile Git histories with a normal merge that preserves the deployed/candidate application tree and documents explicitly deferred main features; never force-push.

## Verification record

- Feature group: 18 Vitest files, 103/104 assertions passed; a completed-attendance UI lookup timed out under parallel load, then its file passed alone (14/14).
- Cashier/order/Payper group: 17 Vitest files, 97/98 passed; a Payper link lookup timed out under parallel load, then passed alone (1/1). No payment source file changed.
- Order, scheduling, quote, layout and PDF group: 9 files / 55 tests passed.
- Final targeted rerun after voucher/report adjustments: 4 files / 7 tests passed.
- Payment client/server regression: 5 Vitest files / 76 tests and 8 Node files / 54 tests passed, including J4 first response, uncertain recovery and duplicate delivery.
- Controlled Vercel deploy script: 12 Node tests passed, including Windows executable resolution. No deployment command was run.
- PGlite full schema rehearsal: 102 migrations, 85 tables, 304 functions, 141 policies, 129 triggers, 1,257 constraints, zero unvalidated constraints; mocked digital, cash, physical and hosted document scenarios passed.
- `npm run lint`, `npm run build` and `git diff --check` passed. The production build generated the Vite bundle locally only.
- Whole-project `npm run typecheck` remains red on existing dependency, Radix/UI and test typing errors in the protected baseline. A filtered rerun reported no diagnostics in the newly restored feature source after targeted fixes. The full typecheck is therefore **not** claimed green.
- A combined 35-file UI Vitest run with two workers did not finish and was interrupted; focused groups and isolated reruns above provide the verified results. Mocked tests do not establish live Edge, Storage, provider or customer communication behavior.
