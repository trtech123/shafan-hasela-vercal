# Group A controlled Production acceptance — 2026-11-19

Scope: customer management, clubs, attendance and linked instructor access only. The release is an application deployment from the protected Production source. It has no migration, Edge deployment or payment configuration change. Never use ORD-1062, CT20, real customer contact details, or provider actions as test fixtures.

## Release gate

1. Confirm the live alias still resolves to the protected Production deployment and SHA. Confirm the Group A branch is clean, pushed, and still differs from the protected tree only in operational UI, role access, synthetic browser test and documentation. The controlled deploy script checks the linked Vercel project, `app` root, Vite framework and remote branch SHA.
2. Confirm the 19 November scheduled physical backup is **completed**, appears with a Restore control, and is later than the 19 November ORD-1062 reconciliation. Record its actual UTC timestamp. Physical backups cannot be downloaded for a local restore rehearsal. A separate restored project costs money and is outside scope; describe the completed backup as available through Supabase, not as drill-proven. Storage object bytes are not covered. Group A does not write Storage.
3. Immediately before deployment, run read-only aggregate checks on orders, payment transactions and events, physical intents, Payper ledger, accounting documents, manual payments and provider audit tables for changes after the backup. If a critical financial write occurred after it, wait for a newer recovery point or obtain a separately approved safe backup. Confirm no unresolved financial activity and a low-activity window.
4. Confirm the live customer RLS, attendance RPCs, instructor link RPCs and deployed `create-user` instructor role contract still match the candidate. Confirm no provider trigger on synthetic operational tables. Stop on any mismatch.

## Synthetic acceptance records

Use the unique prefix `[GROUP-A-TEST-20261119]` in every operational name or note. Maintain an ID ledger before each write. Create three dedicated Auth users with reserved test email addresses and fresh temporary passwords: Admin, Cashier and Instructor. The existing administrator provisions them through the deployed admin-only `create-user` function. Do not send invitation or reset emails. Link only the test Instructor profile to the test instructor record; no name or email inference.

Create one test customer with no real phone/email, one test instructor, one zero-price test club, one test participant with no contact details, one zero-price test membership with `payment_status='not_enrolled'` and no recurring agreement, and one same-day manual session. The club enrollment button calls `club-recurring-enroll` and must **not** be used. The membership may be created only as an explicitly marked synthetic operational row after confirming current constraints and trigger inventory; otherwise skip roster writes and report the acceptance gap. No recurring agreement, charge, accounting document or provider request may be created.

## Acceptance sequence

| Role | Desktop and mobile checks | Required result |
| --- | --- | --- |
| Admin | Login; create, edit, search and archive test customer; create manual test session; link test Instructor; prepare test roster; mark test attendance and inspect audit | All operational actions succeed; no provider or delivery call |
| Cashier | Login; create/edit/search test customer; attempt archive; attempt admin attendance route | Customer work succeeds; archive and admin attendance are denied |
| Linked Instructor | Login; see only assigned test session and test participant; mark attendance; attempt customer and admin routes | Own roster works; unassigned and admin data are denied |

Test each role at desktop width 1440 and mobile width 390. Record IDs, timestamps, observed UI result and any network error. Stop immediately if an unexpected payment, invoice, email, WhatsApp or unrelated data action appears.

## Rollback and cleanup

If the application regresses, stop acceptance and promote the prior READY Vercel deployment after verifying its compatibility with the unchanged Production schema. Do not restore the entire database for an application-only regression. Do not replay migrations or touch payment gates.

Archive the synthetic customer. Cancel the synthetic session where allowed; keep attendance audit intact. End/deactivate the synthetic membership and test club/instructor without invoking recurring cancellation or provider actions. Revoke/disable the three dedicated test users after testing, preserving audit references as required by foreign keys. Record any marked synthetic rows retained for audit. Never delete or rewrite real orders, payments, invoices or the ORD-1062 reconciliation.
