# Group A Production acceptance record — 2026-11-19

This record contains only synthetic operational IDs. Test passwords, service keys, real customer details and provider responses are excluded.

## Release gate and deployment

- Protected live baseline before release: `dpl_AQKAKWDGJvcp1s2YokgBVs2xffeP`, source `73690eee338b400bd9310e8fb283806852f43f29`, READY.
- Supabase scheduled physical backup: **2026-11-19 17:34:02 UTC**, shown with a Restore action. It followed the separately completed ORD-1062 reconciliation at about 14:02 UTC. A physical restore drill was not performed: the backup is not directly downloadable, no local database password is available, and a restored cloud project would add cost and could start copied jobs. Storage object bytes are not covered by the database backup; Group A made no Storage write.
- Before deployment, read-only queries found no post-backup changes in the checked orders, payment, physical intent, Payper, Pelecard, sales, document, and recurring-charge tables. Customer, club-session and membership tables also showed no post-backup changes before synthetic acceptance.
- Deployed through `scripts/vercel/production-deploy.mjs --deploy`: **`dpl_2z6PRpf8qeD9wjECEi773XN43b3j`**, source **`86dab2b1c9d1b6de8a61c39b5a42458557e5eb0b`**, branch `integration/operational-restoration-20261118`, READY, live alias `https://shafan-hasela-vercal.vercel.app`. Post-test `--status` confirmed the same alias, ID, SHA and READY state.
- No migration, Edge deployment, payment-gate change, environment-variable change, paid resource, provider call or external message was performed. The deployed `create-user` function was inspected read-only: instructor is allowed, caller must be Admin, and JWT verification is enabled.

## Acceptance results

| Area | Observed Production result |
| --- | --- |
| Admin | Dedicated test Admin logged in; created, edited, searched and archived the marked customer; created a marked instructor, zero-price club and same-day manual session; linked the test Instructor, prepared a roster and marked attendance. |
| Cashier | Dedicated test Cashier logged in; opened and edited the marked customer. Archive control was absent; direct Admin attendance route redirected to the schedule. |
| Instructor | Dedicated linked test Instructor saw the assigned test session and participant, changed attendance to excused, and was redirected away from customer and Admin attendance routes. |
| Mobile | At 390×844, Admin customer and attendance screens, Cashier customer screen and archive denial, and Instructor assigned roster/status were observed. The same roles and flows were rehearsed locally with synthetic network responses at 1440×900 and 390×844. |
| Protected routes | Existing orders list and cashier route loaded in Production. No checkout or payment action was taken. Protected POS, payment, Payper and deployment files matched the pre-release Production source in the file-level comparison. |

Local verification on the deployed source: 61 operational/role tests passed when run by file; 11 cashier POS, 5 Direct J4 client, 3 Payper billing and 12 controlled-deploy tests passed. ESLint and Production Vite build passed. A multi-file Vitest run stalled on this Windows host and one attendance test timed out under load; its standalone rerun passed 14/14. No application regression was reproduced.

## Synthetic record ledger and cleanup

Every record uses `[GROUP-A-TEST-20261119]`. There are no real contact details or recurring agreements. The test instructor's required phone was a non-routable synthetic `0000000000`; no call or message was sent.

| Record | ID | Final state |
| --- | --- | --- |
| Customer | `3f032e58-7223-4374-96d2-e89ae4063504` | Archived |
| Club | `49e7b0fc-96d3-4394-ac7d-09bb2253acf4` | Archived; monthly price ₪0 |
| Instructor | `af1bda85-1583-4ba6-8ece-f4f795735663` | Inactive; account link removed |
| Participant | `a71d8849-4fa4-48e4-a041-e193418ab4e4` | Retained without contact details for immutable attendance history |
| Membership | `4104f9f6-4d46-456f-9ed7-52e423203146` | Ended; ₪0; no recurring agreement |
| Manual session | `8f3588ff-53cb-4fdc-aa73-800d7426eaa5` | Cancelled through the Admin RPC; audit retained |
| Admin test user | `2f542eb0-ea60-4783-a876-2d804c897c8e` | Global sign-out and banned |
| Cashier test user | `54e00f6a-8d84-4efb-a8ef-e4429a72fab1` | Global sign-out and banned |
| Instructor test user | `03438123-d5ba-46db-b591-2165d208ed1a` | Global sign-out and banned |

Read-only post-cleanup queries verified the six operational states, all three bans and zero active links for the test instructor. Supabase access JWTs can remain valid until expiry even after global sign-out; the temporary test browser was closed and no credentials were retained in the repository. The marked operational history is retained deliberately. Removing it would require a separate data-retention decision, not a blanket delete.

## Financial and configuration post-check

Read-only post-acceptance queries found **zero rows changed after the backup** in `orders`, `sales`, `payment_transactions`, `payment_transaction_events`, `physical_payment_intents`, `payper_document_ledger`, `payper_noncard_payments`, `pelecard_live_audit` and `pelecard_test_payments`. `accounting_documents`, `manual_order_payments`, `immediate_accounting_payment_evidence` and `recurring_charges` had zero rows. The synthetic membership had zero recurring agreements. No official document was generated.

No Production database schema, RLS, Edge function, Vercel environment variable, payment gate, CT20 lock, ORD-1062 record or provider configuration was modified in this release. The application rollback point remains the prior READY deployment; a full database restore is not an appropriate routine rollback for this application-only release.
