# Shafan Hasela Deterministic Multichannel Chatbot Design

**Status:** Approved design, documentation only

**Implementation base:** Implementation must start from the exact frozen `integration/shafan-final` commit supplied by the owner. This planning branch is intentionally based on `3abff83` and must not be treated as the implementation base.

## Purpose

Build “שפן”, a deterministic Hebrew customer-service bot for WhatsApp, Facebook Messenger, Instagram DM, and email. The bot answers only from the client-approved content version, collects lead details, and transfers every pricing request, complaint, complex/custom event, unsupported question, or unknown question to a human.

V1 will not generate factual answers with an LLM. It will not read operational pricing, orders, clubs, payments, accounting, or billing data. Once a handoff begins, automatic responses stop until staff explicitly resume or close the conversation.

## Source authority

The final client-document section titled `תסריט בוט — שפן הסלע / מסמך הטמעה למפתח הבוט`, version 1.0 dated July 2026, is the canonical business-content contract.

Precedence is:

1. The final implementation script in the client document.
2. The approved design decisions recorded here.
3. Earlier research and gap-analysis material only when it does not conflict with the final script.

Business facts in the canonical section are approved and must not be reconfirmed. Content absent from the document is represented as `handoff_only`; it must never be completed from general knowledge, repository data, web search, or an LLM.

The exact transcription is stored under `docs/chatbot/content/v1/he/`. Implementation will copy these records into runtime content modules without rewriting their business text.

## Existing-system boundary

The repository’s WhatsApp capability is an authenticated staff-initiated outbound adapter. The integrated `send-whatsapp` function supports text, document, and one approved order-confirmation Utility template. It is not an inbound webhook and must remain JWT-protected.

Inbound channel endpoints are separate public surfaces. They authenticate providers with channel-specific verification and signatures rather than staff JWTs. They may share pure validation patterns, but they must not call or weaken the authenticated outbound endpoint.

The existing `leads` table is the CRM destination for qualified or handed-off conversations. It is not conversation, message, webhook-event, or session storage. The Clubs/iCredit, Pelecard, Rivhit, order, quote, and pricing domains remain inaccessible to the chatbot.

## Architecture

```text
WhatsApp webhook ─┐
Messenger webhook ├─> channel normalizer ─> canonical inbound event ─┐
Instagram webhook ┤                                                   │
Email ingress ────┘                                                   ▼
                                                          deterministic engine
                                                               │     │
                                                approved content│     │session state
                                                               ▼     ▼
                                                         response actions
                                                               │
                             ┌─────────────────────────────────┼──────────────────────┐
                             ▼                                 ▼                      ▼
                      channel sender                    persisted messages       handoff/lead
```

### Channel gateways

Each gateway has one responsibility: verify its provider, normalize the incoming payload, and pass a canonical event to the processor. Provider payload shapes never enter the conversation engine.

Canonical inbound event:

```ts
type Channel = "whatsapp" | "messenger" | "instagram" | "email";

type InboundEvent = {
  channel: Channel;
  providerEventId: string;
  providerMessageId: string;
  externalContactId: string;
  threadId: string;
  text: string;
  receivedAt: string;
  contact: {
    displayName?: string;
    phone?: string;
    email?: string;
  };
};
```

Unsupported attachments or event types are recorded safely and handed off when they represent a customer message. Delivery/read/status callbacks update message state but do not invoke the engine.

### Deterministic conversation engine

The engine is a pure function over the approved content, current session, and normalized event:

```ts
type EngineResult = {
  nextState: string;
  sessionPatch: Record<string, unknown>;
  actions: Array<
    | { type: "send"; responseId: string; menuId?: string }
    | { type: "capture"; field: string; value: string }
    | { type: "handoff"; reason: string; priority: "normal" | "high" }
  >;
};
```

The engine accepts exact option IDs, menu numbers, and a small reviewed alias list. It performs no open-ended semantic inference. An input that cannot be resolved to one approved transition returns `handoff.unknown`.

Global commands in every automated state are `תפריט`, `חזרה`, and `נציג`. `תפריט` returns to the main menu, `חזרה` returns to the stored parent state, and `נציג` starts handoff.

### Content loader

Content is versioned, immutable for a deployed release, and validated at startup and in tests. A conversation stores the content version with which it began. A later content release affects new conversations; an explicit migration or restart rule is required before changing an active conversation’s version.

The V1 canonical structure is:

```text
docs/chatbot/content/v1/he/
  README.md
  profile.json
  menus.json
  sites.json
  activities.json
  policies.json
  safety.json
  faq.json
  handoff.json
```

Runtime copies will live under `supabase/functions/_shared/chatbot/content/v1/he/`. The flat `message_templates` table remains for operational messages and is not the chatbot knowledge base.

## Runtime data model

### `bot_contacts`

Stores one normalized customer identity per channel: channel, external contact ID, display name, phone/email when supplied, opt-out status, blocked status, and timestamps. A channel identity is unique; cross-channel merging is not automatic.

### `bot_conversations`

Stores channel, contact, thread ID, content version, current state, parent state, selected site/activity, collected-fields JSON, status, last-message timestamp, and expiry timestamp.

Allowed statuses:

- `automated`
- `awaiting_human`
- `human_active`
- `resolved`
- `closed`

### `bot_messages`

Stores conversation, provider message ID, direction, kind, body, delivery status, timestamps, and sanitized provider metadata. Provider message ID plus channel is unique for replay protection.

### `bot_channel_events`

Stores the verified provider-event identity, payload digest, processing status, retry count, and timestamps. Raw credentials and authorization headers are never stored.

### `bot_handoffs`

Stores conversation, reason, priority, customer summary, captured contact/site/activity/group/date fields, status, assignee, linked lead, creation time, first-human-response time, and closure time.

The handoff queue is a staff operational view over this table. Leads receive CRM fields only after a handoff/lead is created; they do not contain transcripts or engine state.

## Handoff behavior

Automatic handoff triggers are:

- Quote request.
- Specific price question.
- Complaint or problem.
- Event over 50 participants.
- Complex or custom package.
- Any question without an approved deterministic answer.
- Any `handoff_only` content entry.
- Explicit `נציג` request.

The engine captures, when available:

- Name.
- Phone or preferred callback number.
- Email.
- Company/organization.
- Requested site/activity.
- Group size.
- Preferred date.
- Short request summary.

Missing optional fields never delay a complaint or explicit human request. WhatsApp’s sender number is accepted as the callback number unless the customer supplies another. The approved transfer response is sent once as handoff begins. After the conversation status becomes `awaiting_human`, the bot sends no automatic response. Staff must explicitly claim, resume, resolve, or close the conversation.

## Canonical conversation flows

### Welcome and main menu

The exact approved welcome response is followed by seven normalized options: activities, corporate/groups, pricing/booking, directions, safety, clubs/teams, and FAQ. The source document displays FAQ as a second option 6; the approved semantic seven-option menu renders FAQ as option 7.

### Activities and facilities

The site menu routes to Acre, Berko/Tiberias, field activities, or Nof HaGalil.

- Acre presents climbing, Sky Trek, Bungee Drop, zipline, Extreme Kids, and events/groups. Each factual response is loaded verbatim from `activities.json`. Events/groups enter the corporate flow.
- Berko returns only the approved overview.
- Field activities return the approved list and offer a custom-package handoff.
- Nof HaGalil and detailed Via Ferrata questions are `handoff_only` because the document supplies references but no operational details.

### Corporate/group events

The bot sends the approved corporate overview, asks for the approved size bucket, captures lead fields, creates the handoff, and sends the approved contact/one-business-day response. All corporate choices reach a human; events over 50 also satisfy the explicit automatic-handoff rule.

### Pricing and booking

The bot never states or calculates a specific price. It may state only the approved VAT, minimum-participant, Tiberias-resident-pricing, and 48-hour final-count policies, then captures lead fields and hands off.

### Directions

Acre returns the approved address and regular/August hours. Berko returns the approved phone-confirmation response. Other site/directions requests are `handoff_only`.

### Safety

The five approved subjects are weight, pregnancy/back/neck restrictions, minimum age/supervision, safety equipment, and conduct. The bot repeats only the scripted response. A personalized medical, exception, or activity-specific question hands off.

### Clubs and teams

The main-menu entry exists. The bot may ask whether the inquiry concerns a climbing club or team solely to enrich the summary, then captures contact/participant-age/site details and hands off. It must not query club schedules, capacity, member records, monthly price, payment state, or enrollment functions.

### FAQ

The FAQ answers are parking, rain, clothing, accompanying parent, cancellation, ticket contents, and food. The accompanying-parent answer itself directs the customer to a representative.

### Unknown question

The bot sends the approved transfer response from `handoff.json`, stores the customer’s original text as the summary, and immediately hands off. It does not attempt a generative answer, invent a separate fallback message, or perform a web search.

## Staff handoff queue

V1 adds an authenticated staff page with filters for waiting, active, resolved, channel, reason, age, and assignee. Each row exposes the collected fields and transcript. Staff actions are claim, send reply, resume bot, resolve, and close.

Claim changes `awaiting_human` to `human_active`. Resume is explicit and returns to the main menu rather than guessing the prior intent. Resolve records the first response/SLA timestamps and keeps the transcript accessible. Close prevents new automatic messages until a new inbound message creates or reopens a conversation according to the approved session policy.

## Security and reliability

- Public channel endpoints do not accept staff JWT authorization as provider proof.
- Meta payloads require verification-token subscription checks and app-secret signature validation.
- Email ingress requires the selected provider’s signature verification.
- Duplicate provider message/event IDs are acknowledged without reprocessing.
- Persist before send; record outbound acceptance and later delivery status separately.
- Store only required provider metadata; redact message bodies, phone numbers, emails, tokens, signatures, and payloads from logs.
- Enforce payload-size, text-length, event-age, retry, and rate limits.
- Opted-out or blocked contacts receive no automated marketing or re-engagement messages.
- Customer-service-window/template rules belong to channel adapters, not the engine.
- The bot service role can access only bot tables and the minimum lead-write operation. It has no club, payment, accounting, order, quote, or pricing read permissions.

## Error handling

Invalid provider authentication returns an authorization error without processing. Malformed authenticated events are recorded as failed and acknowledged according to provider retry semantics. A persistence failure produces no customer reply, avoiding an untracked conversation. A send failure remains retryable and never advances the state twice. Engine/content validation failures fail closed to human handoff when persistence remains available.

## Testing strategy

Testing is contract-first and transcript-driven:

- Content-schema and exact-transcription snapshot tests.
- Static proof that all menu targets and response IDs exist.
- State-machine unit tests for every menu edge and global command.
- Price-leak tests proving no bot response accesses or renders specific prices.
- Handoff tests for every mandatory trigger and automation lock.
- Replay/idempotency tests for provider events and messages.
- RLS/authorization contract tests proving bot isolation from operational domains.
- Channel-normalization fixtures for WhatsApp, Messenger, Instagram, and email.
- End-to-end sandbox transcripts for all approved flows.

## Delivery sequence

1. Versioned approved content, runtime schema, deterministic state machine, and staff handoff queue.
2. WhatsApp inbound webhook and end-to-end conversation.
3. Messenger and Instagram adapters.
4. Inbound email adapter and threading.
5. Security, replay, opt-out, retention, and all-channel staging acceptance.

No implementation, push, or deployment begins until the owner supplies the frozen integration commit.

## Technical inputs still required

- Exact frozen `integration/shafan-final` commit.
- Final available migration number; `026` is currently expected and must be rechecked.
- Meta App, WABA, phone-number, Page, and Instagram account relationships and production permissions.
- Webhook verify token and Meta app secret provisioning.
- Inbound email provider and signature/threading contract.
- Staff roles allowed to claim/respond/resume/close handoffs.
- Internal handoff notification destination and ownership/escalation workflow.
- Business-day calendar used for SLA measurement.
- Approved Hebrew prompt copy and ordering for any lead fields the bot should actively request. Until supplied, the bot captures only channel/profile data and information the customer already provided, then hands off without delay.
- Transcript/message/event retention periods and deletion authority.
- Opt-out keywords and whether opt-out is channel-specific or cross-channel.
- Sandbox identities and production rollout recipients.
- Authorization to align or retire the stale legacy `OrderDocumentDialog` copy.
