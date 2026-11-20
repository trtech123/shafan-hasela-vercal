# Document delivery and signatures: Production preflight (read only)

## Baseline and integration

On 2026-11-20 the live Vercel alias `shafan-hasela-vercal.vercel.app` resolved to READY deployment `dpl_6vA2k24R61d6BSMtSApkx2MhPPWb`. The CLI deployment did not publish a Git SHA in its metadata. A comparison of deployed file digests found the checkout-safety `OrderCollection.jsx` from `d31e3fe57d1a05b4f210bb7fa1dc813bd667d8ea`; the older `e29fedd` file digest was absent. Treat `d31e3fe` as the source-equivalent protected baseline, and reconfirm the alias and file digests immediately before a release.

This isolated candidate cherry-picks only document commits `b88f7b1`, `8032a72`, `5fa434d`, `a9fcdce` onto `d31e3fe`. The base's checkout-safety files, payments, Pelecard, Payper, Direct J4, chatbot webhook and financial gates are untouched by the candidate diff. Do not merge an unrelated payment worktree.

## Verified test records in Production

Read-only SQL on 2026-11-20 found `ORD-1065` as `08116ecb-c3b2-4b17-b969-94ded3963ffe`: synthetic order, total 0, `לא שולם`, no quote link, activity `b4a82236-0008-4c9b-a489-d1708b42204a`, no instructor, event 2030-01-01. `QUO-1029` is `062fce38-73ba-49dd-b15d-e2b7fc5008a4`: synthetic draft, total 5, no converted order, revision 1 `cad2340e-9ff0-412f-a794-0730c358b6c0`, event 2030-01-01. Its frozen revision recipient equals the requester's verified test email. Reconfirm recipient in the UI and saved revision before any send.

Related-row counts for these records were zero in quotation delivery, order revisions, order delivery, signature delivery, sales, payment transactions, physical intents, Payper document ledger and accounting documents. The quotation has one saved revision. The private signature bucket had no object under the test order's UUID prefix. These observations do not authorize a message or document generation.

## Production contracts and security

The active ZIP bundles for `send-quote-email`, `send-quote-whatsapp`, `send-order-signature`, and `send-order-doc` were downloaded read-only and compared file by file with this candidate. All shared modules and the signature entrypoint match after line-ending normalization. The two quotation entrypoints differ only in the import path required by their self-contained candidate packaging; both serve the same channel. The deployed `send-order-doc` entrypoint uses versioned `orderDelivery('email')`, while the inherited local entrypoint was obsolete. It has been corrected locally to import the candidate's packaged versioned runtime. **No Edge redeployment is required for this release.** Do not invoke a live function for preflight.

The live `claim_quotation_delivery`, `claim_manual_quotation_delivery`, `finish_quotation_delivery`, `order_signature_action`, `order_signature_delivery` and `order_signature_rate_limit` RPCs are SECURITY DEFINER with EXECUTE for service_role, not anon/authenticated. `order_confirmation_data` is available to authenticated callers and performs its own access checks. The live revision and delivery tables have RLS enabled; authenticated INSERT is denied. The `order-signatures-private` Storage bucket is non-public, PDF-only, 20 MiB maximum, with no direct `storage.objects` policy for that bucket. Server code uses service role, validates hashes and token scope, and keeps uncertain delivery attempts from automatic resend. Vercel Production has `ORDER_SIGNATURE_PUBLIC_ORIGIN`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; the public origin value matches the live domain. Supabase Edge has `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `ORDER_SIGNATURE_PUBLIC_ORIGIN` and default Supabase keys. The Edge origin digest matches the live domain. Secret values and SMTP delivery were not tested. JWT verification with the legacy secret is enabled on the quotation email and signature functions.

The latest scheduled Supabase backup visible at preflight was a PHYSICAL backup dated 2026-11-19 17:34:02 UTC with a Restore control. It predates the synthetic records, does not include Storage objects, and has not been restored in a rehearsal. This release has no migration and its rollback is application-only; never treat the database backup as an application rollback mechanism. Supabase showed a billing grace-period warning; check service/quota health immediately before deployment.

## Release sequence and rollback

1. Reconfirm alias/source, recent recoverable database backup, RPC/RLS/storage policies, sender and origin configuration, and current test-record dependency counts. Resolve any difference before deploying.
2. Obtain approval for the exact application commits. No database migration or Edge deployment is proposed. Deploy the quotation stage from commit `2c8900e` manually and confirm READY/alias. Keep the current READY deployment ID for rollback. Then deploy the final signature stage from the integrated branch, again confirming READY/alias.
3. With no send or signature: verify the quotation panel, order revision creation, PDF rendering, private storage access and token denial for invalid/expired tokens. Generation changes Production data and therefore needs release approval. Use only the two synthetic records.
4. Separately approve one email to the verified personal address for each requested document. Check frozen recipient, attachment, link, persisted attempt and provider ID before the next send. Never retry an uncertain attempt automatically. WhatsApp delivery remains out of scope.
5. If the application fails, restore the prior READY deployment alias. Do not restore the database, delete delivery evidence or retry a message. If an Edge function was changed, redeploy its captured prior bundle only after assessing outstanding attempts.
6. Record all test revision, object and attempt IDs. Retain sent/signed evidence. Archive the synthetic order and quote only after read-only dependency checks; do not hard-delete signed PDFs or delivery history.

Current status: local verification passed; live end-to-end PDF, signature and delivery remain untested. A production release and any email require separate approval.
