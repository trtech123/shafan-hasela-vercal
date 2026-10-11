# Order confirmation signatures — implementation and release gates

Approved scope: additive immutable order-confirmation revisions, public customer signing, private artifacts, staff history, and revision-bound delivery. No production changes or provider sends during implementation.

Base: `ee8a44745484ff919a19ab00a5c8c183c83a2e6f` (canonical main plus production-applied WhatsApp UUID fix). Worktree: `.worktrees/order-confirmation-signature`; branch: `feat/order-confirmation-signature`. Do not merge/push/deploy.

## Tasks

1. Establish baseline tests in the isolated worktree; inspect the order document, delivery contracts, signature mechanics, and migrations.
2. Add database revision/evidence/request primitives and a private artifact bucket. Tests must establish immutable snapshots, exact revision binding, role enforcement, expiry/revocation/supersession, concurrency and replay. Rehearse every migration in a disposable database.
3. Implement a server-authoritative revision renderer and signing API. Archive unsigned PDF; append evidence to the original PDF after acceptance. Freeze terms, safety content and renderer version. Reject client authoritative contents. Token material must never appear in logs or database token columns; store hashes only. Private PDF signing links necessarily carry the capability and require protected artifact access.
4. Extract neutral signature drawing/validation without HAKAFA business coupling. Implement public customer review/name/signature/clear/explicit acceptance/success UI and staff revision history/actions/downloads.
5. Connect existing order email/WhatsApp delivery to archived revisions. Preserve legacy delivery history/idempotency and the exact WhatsApp utility-template contract. Include the email signing link and a real PDF hyperlink annotation.
6. Test malformed and oversized inputs, mouse/touch drawing, clearing, replay/concurrency, old evidence preservation, authorization/private downloads, PDF pagination/RTL/signature/link, and existing email/WhatsApp/HAKAFA regressions. Run build and full relevant tests.
7. Independent specification review, then security/code quality review. Fix findings, rerun affected checks, self-review diff and commit only scoped changes.

## Release boundary

No production migration, frontend/Edge deployment, real email/WhatsApp send, Meta change, Vercel policy change, push or merge is authorized in this task. Actual mobile PDF-viewer link interaction and production smoke tests remain explicit release gates if they cannot be performed locally. Do not report unperformed checks as passed.

## Release sequencing (to refine after tests)

Review migrations and function packaging; apply additive database changes only after separate release authorization, deploy compatible server/Edge code before enabling new UI, verify private storage and authorization, deploy the reconciled feature UI, then perform approved non-financial smoke tests. Preserve existing signed evidence on rollback; disable creation/signing if needed rather than dropping tables or artifacts. Reconcile the UUID migration ancestry separately from any production deployment.
