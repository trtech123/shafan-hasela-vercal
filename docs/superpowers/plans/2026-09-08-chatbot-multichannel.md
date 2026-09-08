# Shafan Hasela Deterministic Multichannel Chatbot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task, `test-driven-development` for every behavior change, and `verification-before-completion` before claiming any phase complete.

**Goal:** Deliver one deterministic, Hebrew-first conversation engine for WhatsApp, Facebook Messenger, Instagram DM, and inbound email, backed only by the approved versioned client content and an explicit staff handoff queue.

**Architecture:** Provider-specific public webhooks verify and normalize inbound events into one canonical event. A pure state machine reads only immutable approved content and conversation state, then emits persistence, send, capture, or handoff actions. Dedicated bot tables hold contacts, conversations, messages, replay records, and handoffs; `leads` is an optional CRM destination, never session storage. The existing authenticated outbound `send-whatsapp` function remains isolated and unchanged.

**Tech stack:** React 18, Vite, Vitest, Supabase/Postgres migrations and RLS, Supabase Edge Functions (Deno/TypeScript entrypoints with testable JavaScript modules), Meta Graph webhooks, and a provider-specific signed inbound-email webhook selected before Phase 4.

**Method:** Test-first throughout: add one focused failing test, observe the intended failure, implement the smallest behavior that passes it, rerun focused and regression gates, then commit.

## Non-negotiable start gate

No implementation task may begin until the owner supplies the exact frozen `integration/shafan-final` SHA.

Set the supplied full SHA, verify it is the frozen branch tip, and create a new implementation worktree from that object:

```powershell
if ([string]::IsNullOrWhiteSpace($env:CHATBOT_BASE_COMMIT)) { throw 'Set CHATBOT_BASE_COMMIT to the owner-supplied full SHA' }
if ($env:CHATBOT_BASE_COMMIT -notmatch '^[0-9a-f]{40}$') { throw 'CHATBOT_BASE_COMMIT must be a full Git SHA' }
git fetch --all --prune
if ((git rev-parse integration/shafan-final) -ne $env:CHATBOT_BASE_COMMIT) { throw 'integration/shafan-final does not match approved SHA' }
git diff --quiet $env:CHATBOT_BASE_COMMIT -- || throw 'Current tracked files differ from approved base'
git worktree add .worktrees/chatbot-implementation -b feature/chatbot-v1 $env:CHATBOT_BASE_COMMIT
git -C .worktrees/chatbot-implementation cherry-pick c94bc7007703132ffbd871548dcca1607cf448b2
```

After the implementation-plan commit is available, cherry-pick it immediately after `c94bc7007703132ffbd871548dcca1607cf448b2`. Do not merge or rebase a moving integration branch into the implementation branch. If the approved SHA changes, discard no work: stop, compare the two bases, and request a revised reconciliation decision.

In the new worktree, run and record the baseline before changing files:

```powershell
git status --short
Get-ChildItem supabase\migrations | Sort-Object Name | Select-Object -ExpandProperty Name
npm --prefix app test
npm --prefix app run lint
npm --prefix app run build
```

Expected: clean status and all three repository gates pass. Re-check the next free migration number. This plan uses `026_chatbot_runtime.sql` because `025` is the latest known integrated migration; if `026` exists on the frozen SHA, stop and revise every migration filename/reference in this plan before implementation.

## Cross-phase invariants

- Never add an LLM, embeddings, semantic search, web search, or generative fallback.
- Never load prices or operational facts from `pricing`, quotes, orders, clubs, payments, Pelecard, iCredit, Rivhit, or accounting data.
- Never expose a public path through `send-whatsapp`; it stays authenticated and staff-initiated.
- Persist and claim a verified inbound event before running the engine or sending a response.
- Duplicate provider events return success without repeating state transitions or replies.
- The approved transfer response is emitted once while entering handoff; `awaiting_human` and `human_active` suppress every later automatic reply.
- Missing approved content always produces `handoff_only`; it never falls back to repository data or model knowledge.
- Tests precede production edits. Each red test must fail for the intended missing behavior before the minimum implementation is added.

## Phase 1 — Content, runtime model, engine, and staff queue

### Task 1: Promote and validate the canonical content package

**Files:**

- Create: `supabase/functions/_shared/chatbot/content/v1/he/profile.json`
- Create: `supabase/functions/_shared/chatbot/content/v1/he/menus.json`
- Create: `supabase/functions/_shared/chatbot/content/v1/he/sites.json`
- Create: `supabase/functions/_shared/chatbot/content/v1/he/activities.json`
- Create: `supabase/functions/_shared/chatbot/content/v1/he/policies.json`
- Create: `supabase/functions/_shared/chatbot/content/v1/he/safety.json`
- Create: `supabase/functions/_shared/chatbot/content/v1/he/faq.json`
- Create: `supabase/functions/_shared/chatbot/content/v1/he/handoff.json`
- Create: `supabase/functions/_shared/chatbot/content-schema.js`
- Create: `supabase/functions/_shared/chatbot/content-loader.js`
- Test: `app/src/lib/chatbotContent.contract.test.js`

**Step 1 — Write the failing contract test**

The test reads the documentation JSON and runtime JSON, asserts deep equality, validates the shared `content_version`, verifies unique IDs, resolves every `answer.*`, `menu.*`, and `handoff.*` transition, and rejects content containing a numeric currency response. It must assert the exact approved strings for Acre August Friday hours, cancellation, VAT, minimum group size, 48-hour final count, and one-business-day response.

```js
expect(runtime.sites).toEqual(documented.sites);
expect(byId(runtime.sites.sites, "acre_extreme_park").hours.august)
  .toBe("א׳–ה׳ 10:00–17:00 | ו׳ 10:00–13:00");
expect(runtime.policies.cancellation.response)
  .toBe("עד 72 שעות — ללא חיוב. אחרי → חיוב 100%");
expect(allCustomerResponses(runtime)).not.toMatch(/(?:₪|ש\"ח|\b\d+[.,]?\d*\s*(?:שקל|שקלים))/);
```

**Step 2 — Run the test and prove red**

```powershell
npm --prefix app test -- src/lib/chatbotContent.contract.test.js
```

Expected failure: runtime content and loader do not exist.

**Step 3 — Add the minimum content and validator**

Create the runtime files by exact transcription from `docs/chatbot/content/v1/he/` using `apply_patch`. `content-schema.js` must validate types, versions, unique IDs, required response text, valid transitions, and `handoff_only` entries. It must fail closed at startup; it must not repair or infer content.

**Step 4 — Re-run and commit**

```powershell
npm --prefix app test -- src/lib/chatbotContent.contract.test.js
git add docs/chatbot supabase/functions/_shared/chatbot app/src/lib/chatbotContent.contract.test.js
git commit -m "feat(chatbot): add approved versioned content"
```

### Task 2: Add isolated chatbot persistence and RLS

**Files:**

- Create: `supabase/migrations/026_chatbot_runtime.sql`
- Test: `app/src/lib/chatbotMigration.contract.test.js`

**Step 1 — Write the failing migration contract**

Assert creation of `bot_contacts`, `bot_conversations`, `bot_messages`, `bot_channel_events`, and `bot_handoffs`; RLS on all five; unique channel/provider event identities; conversation status and message direction constraints; `content_version`; service-role-only webhook writes; authenticated staff read/update policies only through approved roles; and no foreign key from bot runtime tables into club, payment, order, quotation, or accounting tables.

Also assert an atomic SQL function such as `claim_bot_channel_event(...)` returns whether processing was newly claimed, and an atomic `claim_bot_handoff(...)` prevents two staff members from claiming the same item.

**Step 2 — Prove red**

```powershell
npm --prefix app test -- src/lib/chatbotMigration.contract.test.js
```

Expected failure: migration is absent.

**Step 3 — Implement the minimum migration**

Use UUID primary keys and UTC timestamps. Store a digest and sanitized metadata, not raw authorization headers or secrets. Add indexes for `(channel, external_contact_id)`, `(channel, thread_id, status)`, handoff queue status/age/assignee, and unprocessed retryable events. Add optional `lead_id` only on `bot_handoffs`. Do not add bot access grants to operational tables.

The migration must be forward-only and transactional. Role-specific staff policies cannot be finalized until the owner supplies the authorized roles; keep queue access deny-by-default until that input is recorded in the same change.

**Step 4 — Verify locally and commit**

```powershell
npm --prefix app test -- src/lib/chatbotMigration.contract.test.js
npx supabase db reset
git add supabase/migrations/026_chatbot_runtime.sql app/src/lib/chatbotMigration.contract.test.js
git commit -m "feat(chatbot): add isolated conversation persistence"
```

Expected: contract passes and local database reset applies all migrations. If a local Supabase runtime is unavailable, the task is not complete; establish it or use the repository’s approved migration-validation environment.

### Task 3: Implement canonical input resolution

**Files:**

- Create: `supabase/functions/_shared/chatbot/normalize-input.js`
- Test: `app/src/lib/chatbotInputResolver.test.js`

**Step 1 — Write failing examples**

Cover Arabic digits, Hebrew labels, approved aliases, surrounding whitespace, bidi marks, `תפריט`, `חזרה`, `נציג`, empty text, ambiguous labels, and arbitrary prose. Assert only exact deterministic matches resolve.

```js
expect(resolveInput(" 1 ", mainMenu)).toEqual({ type: "option", id: "activities" });
expect(resolveInput("תפריט", mainMenu)).toEqual({ type: "command", id: "main_menu" });
expect(resolveInput("כמה עולה כניסה?", mainMenu)).toEqual({ type: "unknown" });
```

**Step 2 — Prove red, implement, prove green**

```powershell
npm --prefix app test -- src/lib/chatbotInputResolver.test.js
```

Normalize Unicode and harmless whitespace only. Do not add fuzzy matching, keyword scoring, or intent classification. Then rerun the focused test.

**Step 3 — Commit**

```powershell
git add supabase/functions/_shared/chatbot/normalize-input.js app/src/lib/chatbotInputResolver.test.js
git commit -m "feat(chatbot): resolve menu inputs deterministically"
```

### Task 4: Implement the pure state machine with transcript tests

**Files:**

- Create: `supabase/functions/_shared/chatbot/state-machine.js`
- Create: `supabase/functions/_shared/chatbot/session.js`
- Test: `app/src/lib/chatbotStateMachine.test.js`
- Test: `app/src/lib/chatbotTranscripts.test.js`

**Step 1 — Write failing state tests**

Cover welcome/main menu, each site/activity edge, corporate size selection, pricing, directions, each safety answer, clubs, every FAQ, global back/menu/human commands, unknown input, complaint, price language, custom event, and event sizes over 50. Each expected send action references an approved `responseId`, not inline business prose.

Required transcript assertions include:

```js
expect(run(["start", "1", "1", "3"])).toMatchObject({
  status: "automated",
  lastResponseId: "activity.acre_bungee_drop",
});
expect(run(["start", "3"])).toMatchObject({ status: "awaiting_human" });
expect(run(["start", "כמה זה עולה?"])).toMatchObject({
  status: "awaiting_human",
  handoffReason: "specific_price",
});
```

Price/complaint recognition must be a small reviewed denylist of explicit patterns used only to route to handoff, never to answer. Any other unmatched prose routes to `unknown_question`.

**Step 2 — Prove red**

```powershell
npm --prefix app test -- src/lib/chatbotStateMachine.test.js src/lib/chatbotTranscripts.test.js
```

**Step 3 — Implement minimal pure transitions**

The engine signature is `advance({ content, session, input })`. It returns data actions only and performs no I/O. On handoff it emits the approved transfer response once and a handoff action, changes status to `awaiting_human`, and stores the original text summary. If status is `awaiting_human` or `human_active`, later customer messages are persisted for staff but do not re-enter `advance` and receive no automatic response.

**Step 4 — Green, full test, commit**

```powershell
npm --prefix app test -- src/lib/chatbotStateMachine.test.js src/lib/chatbotTranscripts.test.js
npm --prefix app test
git add supabase/functions/_shared/chatbot/state-machine.js supabase/functions/_shared/chatbot/session.js app/src/lib/chatbotStateMachine.test.js app/src/lib/chatbotTranscripts.test.js
git commit -m "feat(chatbot): add deterministic conversation engine"
```

### Task 5: Add the transactional event processor and repository

**Files:**

- Create: `supabase/functions/_shared/chatbot/repository.js`
- Create: `supabase/functions/_shared/chatbot/process-event.js`
- Test: `app/src/lib/chatbotEventProcessor.test.js`

**Step 1 — Write failing orchestration tests**

With an in-memory fake repository and sender, prove: a new event is claimed once; inbound message persists before engine execution; state advances once; outbound intent persists before send; provider acceptance updates delivery data; duplicate event/message IDs do not send; send failure remains retryable without a second transition; handoff creates one record and optional lead data; locked conversations append inbound messages without automatic response.

**Step 2 — Prove red, then implement dependency-injected orchestration**

```powershell
npm --prefix app test -- src/lib/chatbotEventProcessor.test.js
```

`processInboundEvent({ event, repository, engine, content, sender, clock })` must contain no provider-specific payload logic. Do not log message bodies or contact identifiers.

**Step 3 — Verify and commit**

```powershell
npm --prefix app test -- src/lib/chatbotEventProcessor.test.js
git add supabase/functions/_shared/chatbot/repository.js supabase/functions/_shared/chatbot/process-event.js app/src/lib/chatbotEventProcessor.test.js
git commit -m "feat(chatbot): process inbound events idempotently"
```

### Task 6: Build authenticated staff handoff operations

**Files:**

- Create: `supabase/functions/chatbot-handoff-admin/index.ts`
- Create: `supabase/functions/chatbot-handoff-admin/handler.js`
- Create: `supabase/functions/chatbot-handoff-admin/authorization.js`
- Test: `app/src/lib/chatbotHandoffAdmin.test.js`

**Step 1 — Write failing handler tests**

Assert missing/invalid JWT is rejected, unauthorized roles are rejected, claim is atomic, replies require an assigned active handoff, resume returns the session to the main menu, resolve/close record timestamps, and none of these operations accept provider webhook authentication as staff authorization.

**Step 2 — Prove red and implement**

```powershell
npm --prefix app test -- src/lib/chatbotHandoffAdmin.test.js
```

Reuse the repository’s established JWT verification style, but use the owner-approved staff roles. The function may call channel senders; it must never call `send-whatsapp` as a public proxy.

**Step 3 — Verify and commit**

```powershell
npm --prefix app test -- src/lib/chatbotHandoffAdmin.test.js
git add supabase/functions/chatbot-handoff-admin app/src/lib/chatbotHandoffAdmin.test.js
git commit -m "feat(chatbot): add authenticated handoff controls"
```

### Task 7: Add the staff handoff queue UI

**Files:**

- Create: `app/src/pages/ChatbotHandoffs.jsx`
- Create: `app/src/components/chatbot/HandoffFilters.jsx`
- Create: `app/src/components/chatbot/HandoffTranscript.jsx`
- Create: `app/src/components/chatbot/HandoffActions.jsx`
- Create: `app/src/pages/ChatbotHandoffs.test.jsx`
- Modify: `app/src/App.jsx`
- Modify: `app/src/components/Layout.jsx`

**Step 1 — Write the failing page tests**

Render waiting/active/resolved items, channel/reason/age/assignee filters, captured fields, transcript, claim/reply/resume/resolve/close buttons, loading/empty/error states, and role denial. Assert UI actions invoke only `chatbot-handoff-admin`.

**Step 2 — Prove red**

```powershell
npm --prefix app test -- src/pages/ChatbotHandoffs.test.jsx
```

**Step 3 — Implement the smallest queue**

Add an owner-approved role-gated `/chatbot-handoffs` route and navigation item. Keep CRM lead creation server-side during handoff; the page must not store session state in `leads` or query clubs/payment/accounting domains.

**Step 4 — Verify and commit**

```powershell
npm --prefix app test -- src/pages/ChatbotHandoffs.test.jsx
npm --prefix app run lint
npm --prefix app run build
git add app/src/pages/ChatbotHandoffs.jsx app/src/pages/ChatbotHandoffs.test.jsx app/src/components/chatbot app/src/App.jsx app/src/components/Layout.jsx
git commit -m "feat(chatbot): add staff handoff queue"
```

## Phase 2 — WhatsApp inbound webhook and end-to-end flow

### Task 8: Add a separate verified WhatsApp inbound adapter

**Files:**

- Create: `supabase/functions/whatsapp-webhook/index.ts`
- Create: `supabase/functions/whatsapp-webhook/handler.js`
- Create: `supabase/functions/whatsapp-webhook/verification.js`
- Create: `supabase/functions/whatsapp-webhook/adapter.js`
- Create: `supabase/functions/_shared/chatbot/senders/whatsapp.js`
- Test: `app/src/lib/whatsappWebhook.test.js`
- Test: `app/src/lib/whatsappAdapter.test.js`
- Do not modify: `supabase/functions/send-whatsapp/**`

**Step 1 — Write failing verification and normalization tests**

Cover GET subscription challenge, wrong verify token, valid/invalid `X-Hub-Signature-256` using raw request bytes, text normalization, interactive button/list replies, status callbacks, unsupported customer media, batched entries/changes, missing IDs, and duplicate messages.

```js
expect(verifyMetaSignature(rawBody, validHeader, appSecret)).toBe(true);
expect(normalizeWhatsApp(payload)).toEqual([
  expect.objectContaining({ channel: "whatsapp", providerMessageId: "wamid..." }),
]);
```

**Step 2 — Prove red**

```powershell
npm --prefix app test -- src/lib/whatsappWebhook.test.js src/lib/whatsappAdapter.test.js
```

**Step 3 — Implement endpoint and sender**

The public webhook authenticates Meta, normalizes, and calls the shared processor. It does not require a staff JWT. The WhatsApp sender uses shared low-level Meta request helpers only if that reuse does not weaken the outbound function’s authorization boundary; otherwise keep a dedicated server-only sender.

**Step 4 — Regression-proof endpoint separation**

Add a test that an unsigned webhook POST is rejected and a direct unauthenticated POST to `send-whatsapp` remains rejected. Assert no import from the webhook handler into `send-whatsapp/authorization.js` that bypasses JWT validation.

**Step 5 — Verify and commit**

```powershell
npm --prefix app test -- src/lib/whatsappWebhook.test.js src/lib/whatsappAdapter.test.js
npm --prefix app test
git diff --exit-code HEAD -- supabase/functions/send-whatsapp
git add supabase/functions/whatsapp-webhook supabase/functions/_shared/chatbot/senders/whatsapp.js app/src/lib/whatsappWebhook.test.js app/src/lib/whatsappAdapter.test.js
git commit -m "feat(chatbot): add verified WhatsApp inbound webhook"
```

### Task 9: Prove WhatsApp end-to-end conversation behavior

**Files:**

- Create: `app/src/lib/whatsappChatbotE2E.test.js`
- Create: `docs/chatbot/acceptance/whatsapp.md`

**Step 1 — Write an initially failing sandbox transcript test**

Drive real signed fixture payloads through the handler, test repository, engine, and fake Meta sender. Cover welcome → activities → Acre → activity; pricing → collection → handoff; unknown → locked automation; duplicate webhook; human claim/reply/resume.

**Step 2 — Run, fix only integration gaps, and commit**

```powershell
npm --prefix app test -- src/lib/whatsappChatbotE2E.test.js
git add app/src/lib/whatsappChatbotE2E.test.js docs/chatbot/acceptance/whatsapp.md
git commit -m "test(chatbot): prove WhatsApp conversation end to end"
```

Deploy only to the approved Supabase staging project after local gates pass and deployment is separately authorized. Record Meta sandbox message IDs and acceptance results in the checklist; do not use production recipients.

## Phase 3 — Messenger and Instagram adapters

### Task 10: Add Meta Page and Instagram channel adapters

**Files:**

- Create: `supabase/functions/meta-messaging-webhook/index.ts`
- Create: `supabase/functions/meta-messaging-webhook/handler.js`
- Create: `supabase/functions/meta-messaging-webhook/adapter.js`
- Create: `supabase/functions/_shared/chatbot/senders/messenger.js`
- Create: `supabase/functions/_shared/chatbot/senders/instagram.js`
- Test: `app/src/lib/metaMessagingWebhook.test.js`
- Test: `app/src/lib/metaMessagingAdapters.test.js`

**Step 1 — Write failing channel fixtures**

Cover Page subscription verification, signature validation over raw bytes, Messenger text/postback, Instagram DM text/postback, echo events, delivery/read callbacks, unsupported attachments, batched events, and channel-specific external contact/thread IDs. Assert both normalize to the same canonical event shape while retaining distinct `channel` values.

**Step 2 — Prove red, implement thin adapters, prove green**

```powershell
npm --prefix app test -- src/lib/metaMessagingWebhook.test.js src/lib/metaMessagingAdapters.test.js
```

Reuse Meta signature primitives from Phase 2 after extracting them into `supabase/functions/_shared/chatbot/meta-verification.js` with unchanged WhatsApp tests. Keep provider/API differences in senders, not the engine.

**Step 3 — Commit**

```powershell
npm --prefix app test
git add supabase/functions/meta-messaging-webhook supabase/functions/_shared/chatbot app/src/lib/metaMessagingWebhook.test.js app/src/lib/metaMessagingAdapters.test.js
git commit -m "feat(chatbot): add Messenger and Instagram adapters"
```

### Task 11: Add cross-channel transcript parity tests

**Files:**

- Create: `app/src/lib/multichannelTranscriptParity.test.js`
- Create: `docs/chatbot/acceptance/meta-messaging.md`

Feed the same semantic choices through WhatsApp, Messenger, and Instagram fixtures. Assert identical response IDs, transitions, handoff reasons, and automation locks; only transport payloads and external IDs may differ.

```powershell
npm --prefix app test -- src/lib/multichannelTranscriptParity.test.js
git add app/src/lib/multichannelTranscriptParity.test.js docs/chatbot/acceptance/meta-messaging.md
git commit -m "test(chatbot): prove Meta channel behavior parity"
```

## Phase 4 — Inbound email adapter and threading

### Task 12: Freeze the email provider contract before code

**Files:**

- Create after provider selection: `docs/chatbot/email-provider-contract.md`

Record the selected provider, verified inbound domain, signature algorithm and timestamp tolerance, raw-body rules, stable inbound event/message/thread identifiers, reply addressing, subject/thread headers, retry policy, attachment behavior, bounce handling, secrets, sandbox, and deletion behavior. Link official provider documentation and one redacted real sandbox fixture.

This is a hard checkpoint. Do not create a generic unauthenticated email webhook and do not infer a provider from existing outbound email code. Commit the frozen contract:

```powershell
git add docs/chatbot/email-provider-contract.md
git commit -m "docs(chatbot): freeze inbound email provider contract"
```

### Task 13: Implement signed inbound email and threading

**Files:**

- Create: `supabase/functions/email-chatbot-webhook/index.ts`
- Create: `supabase/functions/email-chatbot-webhook/handler.js`
- Create: `supabase/functions/email-chatbot-webhook/verification.js`
- Create: `supabase/functions/email-chatbot-webhook/adapter.js`
- Create: `supabase/functions/_shared/chatbot/senders/email.js`
- Test: `app/src/lib/emailChatbotWebhook.test.js`
- Test: `app/src/lib/emailThreading.test.js`
- Create: `docs/chatbot/acceptance/email.md`

**Step 1 — Write failing tests from the frozen provider fixtures**

Cover valid/invalid/expired signatures, stable replay ID, plain-text extraction, safe HTML-to-text handling, quoted-history removal, subject/references threading, reply destination, attachment handoff, bounce suppression, and duplicate delivery.

**Step 2 — Prove red and implement only the provider contract**

```powershell
npm --prefix app test -- src/lib/emailChatbotWebhook.test.js src/lib/emailThreading.test.js
```

Email is normalized into the same engine. A long or ambiguous free-text email will normally become `unknown_question` and hand off; do not add NLP to improve match rate.

**Step 3 — Verify and commit**

```powershell
npm --prefix app test
git add supabase/functions/email-chatbot-webhook supabase/functions/_shared/chatbot/senders/email.js app/src/lib/emailChatbotWebhook.test.js app/src/lib/emailThreading.test.js docs/chatbot/acceptance/email.md
git commit -m "feat(chatbot): add signed inbound email adapter"
```

## Phase 5 — Security, retention, and all-channel acceptance

### Task 14: Add adversarial security and isolation coverage

**Files:**

- Create: `app/src/lib/chatbotSecurity.test.js`
- Create: `app/src/lib/chatbotReplay.test.js`
- Create: `app/src/lib/chatbotAuthorization.contract.test.js`

Write failing cases for invalid signatures, old timestamps where supported, oversized payloads/text, timing-safe signature comparison, event/message replay, retry races, log redaction, malicious HTML, prompt-injection text, requests for prices, and attempts to retrieve club/payment/accounting/order/quote data. The prompt-injection expectation is handoff, never compliance.

Run with concurrency where practical to prove only one claimant and one outbound action:

```powershell
npm --prefix app test -- src/lib/chatbotSecurity.test.js src/lib/chatbotReplay.test.js src/lib/chatbotAuthorization.contract.test.js
```

Implement only missing controls at the narrowest layer, then commit:

```powershell
git add app/src/lib/chatbotSecurity.test.js app/src/lib/chatbotReplay.test.js app/src/lib/chatbotAuthorization.contract.test.js supabase/functions/_shared/chatbot supabase/functions/*-webhook
git commit -m "test(chatbot): harden webhook and data isolation"
```

### Task 15: Implement approved opt-out and retention policy

**Files:**

- Modify: `supabase/migrations/026_chatbot_runtime.sql` only if Phase 1 has not shipped anywhere; otherwise create the then-next migration
- Create: `supabase/functions/_shared/chatbot/opt-out.js`
- Create: `supabase/functions/chatbot-retention/index.ts`
- Test: `app/src/lib/chatbotOptOut.test.js`
- Test: `app/src/lib/chatbotRetention.contract.test.js`

Do not start until the owner supplies exact opt-out keywords/scope and retention durations/deletion authority. First write tests that encode those approved values. Prove opt-out is recognized before the engine, blocks automated sends, remains auditable without retaining excess content, and can be reversed only by the approved mechanism. Prove retention deletion/anonymization is service-role-only, bounded by explicit cutoff, and excludes unresolved legal/operational holds if the policy defines them.

```powershell
npm --prefix app test -- src/lib/chatbotOptOut.test.js src/lib/chatbotRetention.contract.test.js
npx supabase db reset
git add supabase/migrations supabase/functions/_shared/chatbot/opt-out.js supabase/functions/chatbot-retention app/src/lib/chatbotOptOut.test.js app/src/lib/chatbotRetention.contract.test.js
git commit -m "feat(chatbot): enforce opt-out and retention policy"
```

### Task 16: Run final staging acceptance and freeze evidence

**Files:**

- Create: `docs/chatbot/acceptance/all-channels-v1.md`

Run the complete local gate from the implementation worktree:

```powershell
git status --short
npm --prefix app test
npm --prefix app run lint
npm --prefix app run build
npx supabase db reset
git diff --check
```

Then, only with separate staging authorization, execute every canonical transcript on WhatsApp, Messenger, Instagram, and email sandboxes. Verify:

- Exact Hebrew welcome and every approved answer.
- No specific price under direct, indirect, or injection-style requests.
- All mandatory handoffs and `handoff_only` entries.
- Name/contact/site/activity/group/date/summary capture where available.
- One handoff and one reply under webhook replay.
- Automatic silence after `awaiting_human`/`human_active`.
- Staff claim, reply, explicit resume, resolve, and close.
- Provider delivery/read/bounce status where supported.
- No chatbot reads of clubs, payments, accounting, orders, quotations, or pricing.
- The pre-existing authenticated outbound order-confirmation WhatsApp flow still passes and remains separate.

Record timestamped, redacted evidence and provider message IDs in `all-channels-v1.md`. Do not record access tokens, full phone numbers, email bodies, or signatures.

```powershell
git add docs/chatbot/acceptance/all-channels-v1.md
git commit -m "test(chatbot): record all-channel staging acceptance"
git status --short
```

Expected final state: clean worktree. Do not push, deploy to production, merge, or modify `integration/shafan-final` without explicit owner approval.

## Inputs that intentionally block specific tasks

The following are technical/operational inputs absent from the repository and client document. They do not reopen approved business content.

1. Exact frozen `integration/shafan-final` SHA and confirmed next migration number block all implementation.
2. Meta App/WABA/phone/Page/Instagram relationships, reviewed permissions, tokens/secrets, webhook subscriptions, and sandbox identities block live Phases 2–3 acceptance.
3. Inbound email provider, domain, signature/threading contract, secrets, and sandbox block Phase 4.
4. Staff roles, queue ownership, escalation/notification destination, and business-day calendar block final handoff authorization and SLA reporting.
5. Approved Hebrew prompt copy and ordering for any lead fields the bot should actively request are absent. Without them, V1 must capture only channel/profile data and information already supplied by the customer, then hand off immediately.
6. Exact transcript/message/event retention periods, deletion authority, opt-out keywords, and channel scope block Task 15.
7. Authorization to reconcile or retire stale cancellation copy in `app/src/components/orders/OrderDocumentDialog.jsx` blocks that separate cleanup; it is not part of chatbot scope.
