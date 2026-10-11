# Order confirmation signature controlled release — 2026-10-11

Status: released; awaiting the user's physical-phone signature test. Not final production verification.

## Deployment and preservation

Implementation `51404cf61b6535613808f20be1b286b0e8a42eeb`; accepted candidate `37d2f52946549d15287e48ed2b5b6322d9a83856`. Replaced `dpl_6XPouByDuARH9GzBkTe4cxGxr1vo` with `dpl_AZDsa7wHok7P5ttYhWA5R3d17cHZ` at `2026-10-11T12:17:38.787Z`, Node 24.x.

All 185 previous uploaded files reconciled against the preserved production artifact. Overlaid only 20 reviewed runtime paths (8 replacements, 12 additions), preserving 177 files byte-for-byte. All 197 candidate uploaded source hashes verified before promotion. No wholesale main deployment, merge or push. UUID fix preserved in branch ancestry. Vercel deployment policy unchanged; Git remains blocked.

## Migration and configuration

Applied only `202610110001_order_confirmation_signatures.sql`; verified `2026-10-11T12:09:11.193Z`; SHA256 `e2cc7f144677114d318bf3ea87edcc78cd730fe45dbecd50e4eaff47ab7b47fe`.

Four signature tables have RLS enabled and deny direct anon/authenticated access. Three RPCs are service-role-only with empty search paths. Private `order-signatures-private` bucket is PDF-only, 20 MiB maximum; existing storage policies do not expose it. Existing order-confirmation data RPC unchanged. Existing no-internal-migration-ledger convention preserved.

Added only Vercel server-side `SUPABASE_SERVICE_ROLE_KEY` and `ORDER_SIGNATURE_PUBLIC_ORIGIN`, and matching Supabase Edge origin setting. Existing service credential securely transferred without rotation. No values recorded. Default seven-day expiry retained.

Explicitly deployed only new `send-order-signature`, version 1, JWT verification enabled. After the Edge secret update, all 26 existing function version counters advanced by one, with source timestamps and JWT settings unchanged. Downloaded all their runtime graphs: all 205 files matched recorded production source. No existing function source/provider configuration changes.

## Production checks

- API GET 405; generic invalid-link 404; unauthenticated staff 401; public page 200 with no-store/no-referrer; client bundle service-credential scan passed.
- Anonymous direct table/RPC denied with SQL 42501. Authorized staff history reads passed; instructor denied.
- Authenticated Orders and confirmation preview loaded for existing QA order ORD-1044, labelled `בדיקה QA`, ILS 1. New panel/history loaded; prepare control enabled. No prepare/send/sign/revoke action performed.
- HAKAFA, quotations, clubs, attendance and accounting overview loaded without visible errors. No payment/provider action invoked. Financial code unchanged by source hashes.
- Email input visible. Revision-specific email/WhatsApp controls and authoritative PDF creation await manual preparation; no provider sends used. Accepted automated PDF/provider regression evidence remains in pre-release report.
- Final check at `2026-10-11T12:22:30.874Z`: all 35 monitored business-table fingerprints unchanged; live deployment/policy confirmed; zero revisions, deliveries and artifacts. Invalid-link checks may create only technical rate-limit records.

## Remaining manual gate and rollback

Use existing QA order ORD-1044 without editing: prepare once, copy link, inspect frozen PDF on phone and its clickable signing annotation, finger-sign/clear/redraw, accept and submit once. Refresh admin history and download signed PDF. No email/WhatsApp required. Record time/device/browser/outcome, never the capability URL.

Rollback can promote the retained previous deployment through the authorized CLI process. Keep additive tables, claims, revisions, all signed evidence and private artifacts. Never drop the migration or delete evidence. If evidence exists, assess and preserve secure admin access before rollback. No rollback performed.

No Meta/WABA changes, external messages, payments, accounting documents, existing-order edits or unrelated business-data changes. Physical-phone verification remains pending.
