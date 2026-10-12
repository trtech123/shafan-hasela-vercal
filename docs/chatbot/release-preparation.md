# Chatbot document delivery release preparation

Local release preparation completed on 2026-10-12. No production actions authorized or performed.

## Provenance and isolation

- Branch: `release/chatbot-document-delivery-20261012`.
- Worktree: `.worktrees/chatbot-document-release` under the repository root.
- Freshly fetched canonical `origin/main`: `944190921fc90a379c8da4cf16e45cb699cfcfba`.
- Source: the allowlisted chatbot implementation from `workstream/pelecard-test-isolation`. Only the 28 text files listed in its document-delivery review were initially transferred. No branch cherry-pick or broad directory copy was used.
- Canonical main bundles the webhook's shared modules under `_deployed_shared/chatbot`. Nine changed/new module files were mirrored into that existing bundle, and its imports were preserved. The entrypoint callback received the `unknown` annotation needed for Deno's strict check.
- Added `chatbotReleaseBundle.test.js` to verify module parity, all nine deployed mappings, canonical imports and migration-ID uniqueness.
- Source workstream preserved: 297 modified/untracked source-file hashes were unchanged after isolation.
- Excluded: all local Pelecard/Payper/Rivhit/payment/accounting/order-signature changes, frontend business screens, unrelated migration drafts, root ignore/config changes, package manifests/lockfile changes, Supabase config and Vercel files. Existing canonical main versions are inherited unchanged.
- Nine approved source assets were copied only to the ignored local asset directory for checksum verification. No D1, PDF or JPEG is included in the Git change.

## Migration resolution

`046` is already occupied on canonical main by `046_quotation_lifecycle.sql`. The latest existing canonical migration identifier is `202610110004`.

Final new migration: `supabase/migrations/202610120001_chatbot_document_delivery.sql`.

The new worktree contains no `046_chatbot_document_delivery.sql`; historical migrations, including `202610090001_chatbot_uuid_resolution.sql`, remain unchanged. Canonical migration identifiers are unique. This inspection uses Git migration history; no production database was queried.

## Verification from this worktree

- Canonical baseline targeted suite: 15 suites / 158 tests passed.
- Release targeted suite: **20 suites / 258 tests passed**:
  `npm test -- --run src/lib/chatbot src/lib/whatsapp src/lib/sendWhatsappPayload.test.js src/pages/ChatbotHandoffs.test.jsx` (from `app`).
- `npm run build` (from `app`): passed. Existing Browserslist data-age warning only; dependencies were not changed.
- `deno check supabase/functions/whatsapp-webhook/index.ts`: passed against actual bundled imports.
- `deno check supabase/functions/_shared/chatbot/process-event.js`: passed.
- `node scripts/chatbot/verify-assets.mjs`: all nine asset sizes/SHA-256 values passed; no network/upload.
- `node scripts/chatbot/test-document-migration.mjs <external-PGlite-install-directory>`: **18 document checks passed after all 58 canonical migrations**, with real UUID extension placement and actual Storage policies. No remote connection.
- Existing `scripts/chatbot/rehearse-uuid-resolution.mjs`: passed after the same 58 migrations. First event claim, replay/retry, bot/lead UUID defaults, handoff, authorization and existing quotation/order-confirmation/delivery-acceptance SQL regressions passed in memory.
- Bundled/shared content and runtime parity, unique migration identifiers, staged path allowlist and binary exclusion verified.
- `git diff --check` and staged whitespace checks passed.

PGlite is installed in the OS temporary directory, outside the worktree. Canonical `npm ci` supplies the isolated worktree's app dependencies. No credentials or source-workstream environment files were copied.

## Local commit and review

The single local release commit is directly above the base commit. Use `git log -1 --format=fuller` and `git diff 944190921fc90a379c8da4cf16e45cb699cfcfba..HEAD --name-status` to inspect its exact hash and file inventory. The hash is reported in the release-preparation response to avoid a self-referential commit hash in this file.

The original source workstream was not reset, cleaned or committed. No push, merge, deployment, production migration, Storage upload, real WhatsApp message or Meta/WABA/Vercel change occurred.

## Proposed production sequence — later authorization required

1. Review this isolated commit. Re-fetch canonical main and recheck migration-ID uniqueness before any later integration; preserve blocked Vercel Git auto-deployment.
2. Verify the intended Supabase project's migration history and Storage policies. Apply only `202610120001_chatbot_document_delivery.sql` using the approved targeted migration process and record its version. Do not blindly replay historical migrations.
3. With release credentials supplied securely, run `node scripts/chatbot/verify-assets.mjs --upload` from this worktree. Upload only the nine checksum-approved files to the private bucket and verify bytes, MIME, sizes and access denial for anonymous/authenticated customers.
4. Deploy only `whatsapp-webhook`, including its updated `_deployed_shared/chatbot` bundle. Preserve existing webhook signature verification and Meta configuration. No frontend/Vercel deployment is needed.
5. Under separate explicit authorization, perform a controlled real-message acceptance test and review delivery/handoff records. Do not automatically retry uncertain attempts.

Rollback: restore the prior webhook function release; retain additive database columns and private assets. No release action is included in this preparation task.
