# Shafan Hasela Deterministic Multichannel Chatbot Design

**Status:** Approved design, documentation only

**Implementation base:** Implementation must start from the exact frozen `integration/shafan-final` commit supplied by the owner. This planning branch is intentionally based on `3abff83` and must not be treated as the implementation base.

## Purpose

Build “שפן”, a deterministic Hebrew customer-service bot for WhatsApp, Facebook Messenger, Instagram DM, and email. The bot answers only from the client-approved content version, collects lead details, and transfers every pricing request, complaint, complex/custom event, unsupported question, or unknown question to a human.

V1 will not generate factual answers with an LLM. The generic conversation engine will not read operational pricing, orders, clubs, payments, accounting, or billing data. A future order-confirmation resend may cross into Orders only through the narrow deterministic action boundary defined below; it never makes order data available to the engine. Once a handoff begins, automatic responses stop until staff explicitly resume or close the conversation.

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

The existing `leads` table is the CRM destination for qualified or handed-off conversations. It is not conversation, message, webhook-event, or session storage. The Clubs/iCredit, Pelecard, Rivhit, quote, and pricing domains remain inaccessible to the chatbot. Orders remain inaccessible to the generic engine; only a separately authorized order-confirmation action may read the minimum fields required for association and delivery.

## Order confirmation boundary

There is one canonical order-confirmation document and one existing transactional delivery path:

```text
staff → Orders screen → existing order → existing Order Confirmation PDF
      → order_confirmation_pdf Utility template → customer
```

The existing `OrderConfirmationPDF` component builds the official two-page PDF from the selected order and activity. Its “WA PDF” action sends that generated PDF through the authenticated `send-whatsapp` Edge Function using template name `order_confirmation_pdf`, language `he`, and the existing three server-validated body parameters. This remains the canonical staff-initiated flow.

The chatbot must not create another PDF renderer, reproduce the document markup, reconstruct an order inside bot content, or build template parameters from conversation text. A future inbound request such as `שלחו לי את אישור ההזמנה` or `אני רוצה את אישור ההזמנה שלי` is a request for a privileged action, not a factual bot answer.

The current PDF generator is browser/DOM-based and its output is not persisted or available to a server-side chatbot action. Therefore the safe initial behavior for this intent is `handoff_only`. Automated resend remains disabled until the existing staff flow can persist the exact PDF it generated as a private, immutable order-confirmation artifact. This extends the canonical flow without creating a second document implementation:

```text
Orders screen → existing generator → exact PDF bytes ─┬─> staff download/email/WhatsApp
                                                       └─> private canonical artifact

verified inbound request → deterministic intent → secure action registry
                         → exact order/contact match → same stored artifact
                         → same order_confirmation_pdf Utility delivery core
```

The existing private `documents` bucket can hold the artifact under an order-scoped path. A dedicated Orders-owned `order_confirmation_artifacts` record stores `order_id`, object path, SHA-256 digest, byte count, generator/content version, source `orders.updated_at`, creator, and creation time. An Orders-owned `order_confirmation_delivery_attempts` record audits staff and chatbot deliveries without storing PDF bytes or financial fields. The artifact is current only when its recorded source timestamp/version still matches the order; a missing, corrupt, or stale artifact always hands off so staff can regenerate it through the existing Orders UI.

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
    | {
        type: "request_secure_action";
        actionId: "resend_order_confirmation";
        customerOrderReference: string;
      }
  >;
};
```

The engine accepts exact option IDs, menu numbers, and a small reviewed alias list. It performs no open-ended semantic inference. The two approved order-confirmation request examples may route to `request_secure_action`, but the engine neither resolves nor reads an order. An input that cannot be resolved to one approved transition returns `handoff.unknown`.

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

Stores one normalized customer identity per channel: channel, external contact ID, display name, phone/email when supplied, provider verification source/time, opt-out status, blocked status, and timestamps. A channel identity is unique; cross-channel merging is not automatic. For WhatsApp, only the sender number from a successfully verified Meta webhook is marked as a verified phone; user-entered text never updates that attestation.

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

### Existing order-confirmation request

Until the secure action prerequisites in this design are implemented and enabled, every order-confirmation request hands off. Once enabled, automatic resend is limited to a WhatsApp conversation whose sender identity was verified by a valid Meta-signed webhook and whose customer-supplied order number exactly identifies an eligible order with the same normalized phone number. A phone number merely typed into a conversation is not a verified contact. Messenger, Instagram, and email requests hand off unless a separately approved verified cross-channel identity mechanism is introduced.

The bot never selects “the latest” order, guesses among several orders, discloses candidate orders, or reports totals, payment state, quotation data, or order details. A missing order number, no exact match, phone mismatch, multiple matches, ineligible order, stale/missing artifact, rate limit, or delivery uncertainty all produce a human handoff without revealing which check failed to the customer.

## Secure resend action contract

The safest contract uses opaque server-owned identifiers rather than accepting a caller-supplied `verified_contact` object:

```ts
type ResendOrderConfirmationCommand = {
  action: "resend_order_confirmation";
  orderId: string;           // internal UUID resolved server-side from the exact order number
  verifiedContactId: string; // bot_contacts row attested by the signed WhatsApp webhook
  conversationId: string;
  triggerEventId: string;
  idempotencyKey: string;
};

type ResendOrderConfirmationResult =
  | {
      status: "sent";
      deliveryAttemptId: string;
      providerMessageId: string;
    }
  | {
      status: "handoff_required";
      reason:
        | "contact_not_verified"
        | "order_reference_missing"
        | "order_not_uniquely_resolved"
        | "contact_order_mismatch"
        | "order_not_eligible"
        | "artifact_unavailable"
        | "artifact_stale"
        | "rate_limited"
        | "delivery_failed";
    };
```

`orderId` and `verifiedContactId` are never trusted from a public request. The verified webhook processor records the contact and event, the deterministic resolver converts an exact customer-supplied order number into an internal candidate, and the private action registry constructs the command. The action executor is not directly callable by an anonymous client.

Before any send, the executor atomically verifies all of the following:

1. The triggering event belongs to the conversation and has not already executed this action.
2. The contact is a non-opted-out WhatsApp contact whose number came from a valid Meta-signed inbound event.
3. The order number resolved exactly and the normalized `orders.client_phone` equals that verified WhatsApp sender number.
4. The order status is in the explicitly approved resend-eligible set.
5. The private artifact belongs to that order, passes its stored SHA-256/PDF validation, and was generated from the current order version.
6. The order/contact/action rate limit permits another delivery.

The destination is derived from the matched order/contact pair, never from request input. Template parameters are derived inside the Orders-owned action from the matched order. The executor sends the existing artifact through the same internal `order_confirmation_pdf` Utility delivery implementation used by the authenticated staff endpoint. The public inbound webhook does not invoke or weaken `send-whatsapp`; both endpoints may reuse a private delivery module after their distinct authorization checks.

The action result exposes only delivery or handoff status. It never returns order rows, totals, payment fields, quotation IDs, PDF bytes, signed storage URLs, or candidate-match details to the engine. An action audit record stores the conversation, trigger event, opaque contact/order/artifact IDs, artifact digest, idempotency key, outcome, provider message ID, actor, and timestamps. It must not store the PDF body, totals, payment data, access tokens, or signatures.

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
- The generic engine and channel adapters cannot query Orders. The separately deployed resend executor receives only the narrow Orders capability described above and cannot query quotations, payments, accounting, or clubs.
- A public inbound request can never supply a trusted `orderId`, destination phone, PDF, template name, or template parameters.

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
- Contract tests proving the Orders UI and secure resend use the same artifact bytes and `order_confirmation_pdf` delivery module.
- Association tests for missing/wrong order number, phone mismatch, multiple matches, stale artifact, replay, rate limiting, and cross-channel denial.
- Audit/redaction tests proving no order details, totals, payment data, PDF bytes, or signed URLs enter bot messages or logs.

## Delivery sequence

1. Versioned approved content, runtime schema, deterministic state machine, and staff handoff queue.
2. WhatsApp inbound webhook and end-to-end conversation.
3. Messenger and Instagram adapters.
4. Inbound email adapter and threading.
5. Security, replay, opt-out, retention, and all-channel staging acceptance.

The optional automated order-confirmation resend is a gated extension after the WhatsApp inbound flow. It does not change the five-phase sequence: until its artifact, eligibility, identity, authorization, and audit gates pass, the intent remains `handoff_only`.

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
- Resend-eligible order statuses and resend rate limit.
- Retention period and invalidation/deletion policy for persisted order-confirmation artifacts and action audit records.
- Authorization to align or retire the stale legacy `OrderDocumentDialog` copy.
