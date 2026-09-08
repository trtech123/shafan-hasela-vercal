# Chatbot Handoff Queue Screen Action Map

**Route:** `/chatbot-handoffs`  
**Access:** admin and operations only

## Visible actions

- Filter handoffs by waiting, active, resolved, closed, channel, reason, or assignee.
- Select a handoff to inspect captured contact/request fields and its conversation transcript.
- `קבלת טיפול`: atomically claim an unassigned waiting handoff for the signed-in staff member.
- `שליחת תשובה`: send a staff-authored reply only to the provider identity resolved server-side from the assigned active handoff.
- `החזרת הבוט לפעילות`: resolve the handoff and explicitly resume deterministic automation at the main menu.
- `סימון כטופל`: resolve the handoff while leaving automation stopped.
- `סגירת שיחה`: close the handoff and conversation.

## Data loaded

- `bot_handoffs` with its `bot_conversations`, verified `bot_contacts`, assignee profile, and optional CRM `lead_id`.
- `bot_messages` for the selected conversation, ordered chronologically.

No Orders, quotations, pricing, Clubs, payment, accounting, or billing rows are loaded.

## Data written

- The browser performs no direct writes to chatbot tables.
- All state changes and staff replies invoke the JWT-protected `chatbot-handoff-admin` Edge Function.
- Claim/resume/resolve/close use atomic database functions in the authenticated staff context.
- Replies derive the WhatsApp recipient from the assigned active handoff on the server; the browser cannot provide a destination.

## Cross-screen effects

- Creating a handoff creates and links a normal CRM Lead server-side.
- The Leads screen remains the CRM destination; it does not store transcripts or conversation state.
- Resuming automation affects only the selected conversation and returns it to `menu.main`.

## Acceptance criteria

1. Only admin and operations roles can see or open the route.
2. Waiting and active work are visually distinct and filterable.
3. One waiting handoff can be claimed by only one staff member.
4. Customer and bot/staff transcript messages are clearly distinguished.
5. A reply is available only for the signed-in assignee of an active handoff.
6. Handoff actions call only `chatbot-handoff-admin`; the browser never updates runtime tables directly.
7. Resume is an explicit staff action; waiting and active conversations never receive automatic bot replies.
8. Loading, empty, action-progress, and error states are visible.
