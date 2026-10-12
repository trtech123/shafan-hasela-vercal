# Chatbot document delivery: local review and release notes

Status: isolated release preparation verified on canonical origin/main. See `release-preparation.md` for provenance and fresh checks. No production actions have been taken.

Business approval on 2026-10-12 covers all readable D2–D10 content, including commercial terms and resilience wording. D1 is excluded entirely from the manifest and menus. Missing supplementary files are not generated or referenced as available attachments.

## Customer navigation

Main option 2 (ימי גיבוש לחברות / קבוצות) presents the following numbered topics. Selecting a topic sends exactly its brochure, followed by the existing group-size menu. Group size then enters the existing human handoff. Option 10 goes directly to group size without sending a brochure.

| Choice | Audit ID | Asset ID | Topic | Supplied file |
|---|---|---|---|---|
| 1 | D2 | carmel | יום גיבוש בכרמל | בלב הכרמל.pdf |
| 2 | D3 | berko_day | יום גיבוש בכנרת כולל חוף וארוחה | גיבוש בכנרת 2026-09-17 at 12.44.44.jpeg |
| 3 | D4 | student_resilience | חוסן אישי וקבוצתי לתלמידים | חוסן אישי וקבוצתי_סדנא לתלמידים.pdf |
| 4 | D5 | elah | יום גיבוש בעמק האלה | יום גיבוש בעמק האלה.pdf |
| 5 | D6 | wheels_acre | רייזרים בנחל ציפורי ואקסטרים עכו | יום כיף על גלגלים.pdf |
| 6 | D7 | springs | יום כיף בעמק המעיינות | כיף בעמק.pdf |
| 7 | D8 | heritage | יום תרבות ומורשת בכפר מסריק ועכו | מסע אל העבר.pdf |
| 8 | D9 | berko_treasure | המרוץ למטמון בברקו | מרוץ למטמון_ברקו.pdf |
| 9 | D10 | organizational_resilience | סדנת חוסן ארגוני | סדנת חוסן ארגוני.pdf |

Additional entry paths:

- Main 1 → Berko 2: existing Berko overview, then 1 = D3, 2 = D9, 3 = general group consultation without attachment.
- Main 1 → Acre 1 → events/groups 6: 1 = D6, 2 = general Acre consultation without attachment.
- Main 3 and other unrelated flows retain text/handoff behavior and never send brochures.
- Student and organizational resilience remain independent. No venue is invented for either. The heritage tour is not treated as an Acre park attraction.
- Interactive option IDs are authoritative; an obsolete ID cannot fall back to another numbered package. Switching topic/site clears stale package context before handoff.
- Captions state that a brochure is not confirmation of availability or a booking. Generic VAT wording now defers to the selected brochure/quote.

## Storage and delivery

`supabase/functions/_shared/chatbot/assets.json` is the server allowlist. Each record includes audit ID, asset ID, topic, site (nullable), Hebrew title/customer filename, original local filename, MIME/message type, private bucket/object key, approved version, SHA-256, exact size and enabled flag.

The `chatbot-assets` bucket is private, with a 15 MiB limit and PDF/JPEG MIME allowlist. It has no anonymous or authenticated-user object policies. The existing service-role client downloads objects; customers never receive Storage URLs. The original customer files are ignored by a directory-local `.gitignore`.

The loader verifies enabled status, the checksum captured in the outbound intent, MIME, exact size, file signature and SHA-256. It uploads verified bytes to Meta `/{phone-number-id}/media`, then sends a document/image with the returned media ID through `/{phone-number-id}/messages`. PDFs receive Hebrew filenames; the JPEG receives a Hebrew caption. The existing Graph version, credentials, verified recipient and signed-webhook authentication are retained. See Meta's [media API collection](https://www.postman.com/meta/whatsapp-business-platform/folder/13382743-ecb27be5-4d27-4763-bbee-6a8002c04bf3) and [document media object](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/types/DocumentMediaObject/).

Only webhook function wiring changes; the authenticated staff `send-whatsapp` endpoint and Meta/WABA configuration are unchanged.

## Idempotency and failures

- Existing event claims deduplicate provider webhook IDs.
- Attachment intent stores only asset ID/checksum, customer-facing title and ordinary bot identifiers; no private URLs, credentials, file bytes or raw provider errors.
- A unique event/asset index and service-only `claim_bot_attachment` RPC atomically mark a pending attachment `sending` before provider work. The RPC checks the conversation is automated and the triggering message is recent (23-hour conservative cutoff).
- Missing/disabled/checksum-mismatched assets and known failures go to staff. Expired selections record `attachment_expired` and `document_session_expired` handoff rather than silently completing.
- Network uncertainty after message dispatch, a malformed success response, server errors, or a failure persisting an accepted provider message ID are recorded as uncertain and handed off.
- Failed/uncertain attachment attempts do not enter the existing `send_failed` text retry branch. Replays never repeat an attempted attachment; pending attachments may proceed only after a new successful atomic claim.
- If the process crashes after its claim, the durable `sending` row prevents duplicate delivery. Staff must reconcile stale `sending`/`uncertain` rows; this is deliberately at-most-once dispatch, not a guarantee of delivery. Do not clear attempt timestamps automatically.
- If handoff persistence itself is unavailable, a terminal event error (or the durable claim in a total database outage) remains for operator investigation. No background reconciliation service is added.
- Existing text-message retry behavior is preserved.

## Local verification

Run from `app`:

```powershell
npm test -- --run src/lib/chatbot src/lib/whatsapp src/lib/sendWhatsappPayload.test.js src/pages/ChatbotHandoffs.test.jsx
```

Result in the isolated worktree: 20 suites, 258 tests passed. Coverage includes all nine mappings, signed webhook integration with fake Meta calls, replay/concurrent duplicate events, topic/site/audience isolation, invalid signatures, private asset validation, upload rejection, uncertain sends, persistence failure, expired claims, human handoff and existing text/staff UI behavior. Security contracts check that the new path has no financial/order/accounting dependency.

From repository root:

```powershell
deno check supabase/functions/whatsapp-webhook/index.ts
node scripts/chatbot/verify-assets.mjs
```

Both passed; all nine local files match the manifest. The verification command without `--upload` makes no network calls.

Isolated database test (PGlite dependency installed outside the repository):

```powershell
$chatbotSqlTestDir = Join-Path $env:TEMP 'chatbot-sql-audit'
npm install --prefix $chatbotSqlTestDir --no-save --package-lock=false @electric-sql/pglite
node scripts/chatbot/test-document-migration.mjs $chatbotSqlTestDir
```

Result: 18 checks passed. This executes all 58 canonical migrations, including the UUID extension-resolution fix and new 202610120001 migration, against isolated Supabase fixture schemas in memory. It tests claims, repeated claims, concurrent callers serialized by the embedded engine, expiry, handoff locks, uniqueness, RPC grants, private object RLS and nonretryable attachment errors. It is not a live Supabase or multi-process PostgreSQL load test.

Production Vite build, Deno checks of the deployed entrypoint and shared processor, and scoped `git diff --check` passed. The independent read-only review found an expired-delivery issue; it was fixed and the follow-up review found no remaining blocker.

## Later production actions — NOT performed

1. Review only the files listed below; preserve unrelated work and the blocked Vercel Git auto-deployment policy. No blanket staging, migration push or deployment.
2. Confirm the intended Supabase project, migration history and existing bot schema (026 prerequisites). Review Storage policies to ensure no broad policy grants access to the new bucket. Resolve any migration-number collision before release.
3. Apply **only** `supabase/migrations/202610120001_chatbot_document_delivery.sql` through the approved targeted migration process, transactionally, and record it in migration history. Do not use an unrestricted `supabase db push`: this release contains only one new migration; historical migrations must not be blindly reapplied.
4. Provide `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` securely in the release operator's environment. Run `node scripts/chatbot/verify-assets.mjs --upload`. This uploads only the nine verified allowlisted files with `upsert:false`, and verifies stored bytes; existing matching objects are reused. No D1 or supplementary attachment is uploaded.
5. Verify bucket privacy, object MIME/size/hash, service-role retrieval and denial to anon/authenticated clients in the target project.
6. Deploy **only** `whatsapp-webhook` with its shared chatbot dependencies: `supabase functions deploy whatsapp-webhook --project-ref <reviewed-project-ref>`. Keep the existing webhook signature boundary and JWT configuration. No Meta/WABA changes, new templates, Vercel changes or frontend deployment are required.
7. Only under separate authorization, perform a controlled real-message acceptance test and inspect sanitized bot delivery/handoff records. This implementation session sent no real message.

For rollback, restore the prior webhook function release. Leave the additive database fields and private objects intact. Disabling an asset in the manifest and redeploying the webhook makes its selection hand off; never reset an uncertain attempt to force a resend.

## Exact files in this change

Modified:

```text
app/src/lib/chatbotContent.contract.test.js
app/src/lib/chatbotRepository.test.js
app/src/lib/chatbotResponseResolver.test.js
app/src/lib/chatbotStateMachine.test.js
app/src/lib/whatsappChatbot.integration.test.js
docs/chatbot/content/v1/he/menus.json
docs/chatbot/content/v1/he/policies.json
supabase/functions/_shared/chatbot/content-schema.js
supabase/functions/_shared/chatbot/content/v1/he/menus.json
supabase/functions/_shared/chatbot/content/v1/he/policies.json
supabase/functions/_shared/chatbot/process-event.js
supabase/functions/_shared/chatbot/repository.js
supabase/functions/_shared/chatbot/state-machine.js
supabase/functions/whatsapp-webhook/index.ts
supabase/functions/whatsapp-webhook/sender.js
supabase/functions/whatsapp-webhook/_deployed_shared/chatbot/content-schema.js
supabase/functions/whatsapp-webhook/_deployed_shared/chatbot/content/v1/he/menus.json
supabase/functions/whatsapp-webhook/_deployed_shared/chatbot/content/v1/he/policies.json
supabase/functions/whatsapp-webhook/_deployed_shared/chatbot/process-event.js
supabase/functions/whatsapp-webhook/_deployed_shared/chatbot/repository.js
supabase/functions/whatsapp-webhook/_deployed_shared/chatbot/state-machine.js
```

New:

```text
app/src/lib/chatbotAssetDelivery.test.js
app/src/lib/chatbotAttachmentProcessor.test.js
app/src/lib/chatbotDocumentSecurity.contract.test.js
app/src/lib/chatbotDocuments.test.js
app/src/lib/chatbotReleaseBundle.test.js
docs/chatbot/chatbot-assets/.gitignore
docs/chatbot/document-delivery-review.md
docs/chatbot/release-preparation.md
docs/superpowers/plans/2026-10-12-chatbot-document-delivery.md
scripts/chatbot/test-document-migration.mjs
scripts/chatbot/verify-assets.mjs
supabase/functions/_shared/chatbot/assets.js
supabase/functions/_shared/chatbot/assets.json
supabase/functions/_shared/chatbot/deliver-attachment.js
supabase/functions/whatsapp-webhook/_deployed_shared/chatbot/assets.js
supabase/functions/whatsapp-webhook/_deployed_shared/chatbot/assets.json
supabase/functions/whatsapp-webhook/_deployed_shared/chatbot/deliver-attachment.js
supabase/migrations/202610120001_chatbot_document_delivery.sql
```

Git: isolated branch `release/chatbot-document-delivery-20261012` starts from canonical `origin/main` commit `944190921fc90a379c8da4cf16e45cb699cfcfba`. The release is committed locally; no push or merge. The original workstream remains intact. No PDF/JPEG is tracked/staged. See `release-preparation.md` for the bundle integration additions and final scope.

Remaining blockers: none for local code review. Production readiness depends on review and the explicit release steps above. Real Meta delivery and target-project Storage behavior remain intentionally untested.
