# Stale unclaimed handoff release — local review

Base: reviewed production document release `71ce9e391ac46ef3af54fd750ff4754dfa9b876b`.
Branch: `fix/chatbot-stale-handoff-20261012`. No production writes or deployment.

## Behavior and design

An unclaimed WhatsApp handoff remains locked for less than ten minutes after its database `created_at`.
On a later inbound message, the service-only RPC checks the database clock after acquiring locks.
At ten minutes or more, a `waiting` handoff with both `assigned_to` and `claimed_at` null is eligible,
provided its conversation is still `awaiting_human`. Active/owned handoffs never expire automatically.
No scheduler is needed, and intervening customer messages do not extend this ownership deadline.

The RPC closes (never deletes) the handoff, records `auto_released_at` and `auto_release_event_id`,
restores `automated` / `menu.main`, and clears parent state, site, activity, captured fields and expiry.
It atomically persists one outbound text combining the Hebrew reset explanation and current main menu.
The triggering input is consumed without interpreting it as a menu/package choice. No attachment is
created or sent by reset. Subsequent explicit selections use the unchanged document-delivery flow.
Normal handoff confirmation now explicitly starts with “הבקשה שלך הועברה לנציג.”

The RPC locks handoff then conversation, matching existing claim/close/resume operations. If the
operator wins, expiry returns no rows. If expiry wins, the operator cannot claim the closed handoff.
The existing signed-event claim prevents duplicate webhook processing; competing expiry calls have
one winner. Reset delivery uncertainty is terminal (`handoff_reset_uncertain`), not `send_failed`,
so the existing text retry path cannot automatically duplicate a reset. A crash can leave a pending
or sending intent for inspection; this is deliberately not an exactly-once transport guarantee.

## Migration and release

Apply only `202610120002_chatbot_stale_handoff.sql` after approval. It adds two audit columns, a check
constraint and partial unique event index on `bot_handoffs`, plus `release_stale_bot_handoff(uuid,uuid,text)`.
The RPC is SECURITY DEFINER with `public, pg_temp`, qualified tables and service-role-only EXECUTE.
It requires an already persisted inbound message tied to a claimed WhatsApp message event.
No existing UUID, claim, close, resume, document or financial function is replaced.

Before release, recheck target project, approved source/checksum, the existing document migration,
UUID/handoff definitions and grants, and absence of the new migration markers. Use the established
targeted/manual SQL process in one transaction; no migration ledger or blanket push. Verify RPC
definition/grants, audit columns/index/check, existing functions and bot state immediately afterward.
Then deploy only `whatsapp-webhook` with the matching `_deployed_shared/chatbot` bundle.
No asset upload, frontend deployment, configuration change, Git push or merge is needed.

After deployment, conduct authorized phone QA: old unclaimed conversation -> reset/main menu ->
2 -> explicit package -> correct document -> group size -> handoff confirmation. Confirm under-ten-minute
suppression and that an operator-claimed handoff remains locked until manual resume. Do not fabricate
inbound messages, backdate production rows or automatically resend uncertain messages.

Rollback runtime to version 36 if needed; preserve additive audit schema/history. Do not reopen expired
handoffs or restore stale package context automatically.

## Validation commands

- `npm --prefix app test -- --run src/lib/chatbot src/lib/whatsapp src/lib/sendWhatsappPayload.test.js src/pages/ChatbotHandoffs.test.jsx`
- `npm --prefix app run build`
- `deno check supabase/functions/whatsapp-webhook/index.ts`
- `node scripts/chatbot/test-stale-handoff.mjs <external-pglite-directory>`
- `node scripts/chatbot/test-stale-handoff-races.mjs <external-postgres-directory>`
- `node scripts/chatbot/test-document-migration.mjs <external-pglite-directory>`

The real PostgreSQL harness installs no repository dependency. Its external directory needs `pg` and
`@embedded-postgres/windows-x64` (tested package 18.4.0-beta.17). It starts only a disposable database on
127.0.0.1:55439 and stops it in `finally`. Three independent-session cases observe actual lock waits:
operator first, expiry first, and concurrent expiry. PGlite separately checks both orderings, boundaries,
server-time use, audit/state reset, replay, permissions, old QA context and existing manual resume.

## Results and changed files

Verified locally: 21 suites / 265 tests; final content/bundle/reset check 38 tests;
28 stale-handoff SQL checks; 3 actual multi-session PostgreSQL races; 18 document SQL checks
after 59 migrations; Vite build; both shared and deployed-entrypoint Deno checks; all nine
local asset checksums; `git diff --check`. Build has only the existing Browserslist age warning.

Exact changed/new files:

```
app/src/lib/chatbotAttachmentProcessor.test.js
app/src/lib/chatbotProcessEvent.test.js
app/src/lib/chatbotStaleHandoff.test.js
app/src/lib/whatsappChatbot.integration.test.js
docs/chatbot/content/v1/he/handoff.json
docs/chatbot/stale-handoff-review.md
scripts/chatbot/test-stale-handoff.mjs
scripts/chatbot/test-stale-handoff-races.mjs
supabase/migrations/202610120002_chatbot_stale_handoff.sql
supabase/functions/_shared/chatbot/content/v1/he/handoff.json
supabase/functions/_shared/chatbot/process-event.js
supabase/functions/_shared/chatbot/repository.js
supabase/functions/whatsapp-webhook/_deployed_shared/chatbot/content/v1/he/handoff.json
supabase/functions/whatsapp-webhook/_deployed_shared/chatbot/process-event.js
supabase/functions/whatsapp-webhook/_deployed_shared/chatbot/repository.js
```

Changes are uncommitted for review. No customer binaries, production writes, provider calls,
Meta/WABA changes, Vercel changes, deployment, Git push/merge, or unrelated domain changes.
