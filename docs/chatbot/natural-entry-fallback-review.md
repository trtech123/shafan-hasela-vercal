# Natural entry fallback — local review

Branch: `fix/chatbot-natural-entry-20261012`, based on `1bdb22a67e47de1bd485485489eb7cdd2ae74cea`.

Previously, only an initial greeting whitelist opened the main menu directly. Other unmatched input at main or an active menu ended in `unknown_question` handoff.

Now unmatched entry/main-menu input emits welcome and main menu. An unmatched choice in a configured non-main menu emits a Hebrew clarification and the same menu, preserving the session context and sending no attachment. Explicit commands, configured transitions and existing intentional guarded handoff rules retain precedence. Added `דברו איתי` to explicit human commands. Locked conversation handling and stale-release processing are unchanged.

## Changed files

- `supabase/functions/_shared/chatbot/state-machine.js`
- `supabase/functions/_shared/chatbot/content.js`
- `supabase/functions/_shared/chatbot/content/v1/he/{handoff,policies,profile}.json`
- Matching five files under `supabase/functions/whatsapp-webhook/_deployed_shared/chatbot/`
- Matching three JSON files under `docs/chatbot/content/v1/he/`
- `app/src/lib/chatbotNaturalEntry.test.js`
- `app/src/lib/chatbotStateMachine.test.js`
- `app/src/lib/whatsappChatbot.integration.test.js`
- This review document.

## Validation

- New fallback regression tests initially failed against the previous behavior; passed after the change.
- Relevant chatbot/WhatsApp/payload/handoff UI suites: 22 suites, 282 tests passed.
- Signed local webhook sequence covers ordinary entry, invalid package/group-size input, D9 selection, intended handoff, suppression and duplicate replay without repeated replies/attachments/handoffs. Provider is mocked; no real messages sent.
- Existing tests cover all nine document mappings and stale-release boundaries/claimed locks/manual resume.
- Deno webhook check and application build passed.
- Local stale-handoff SQL rehearsal: 28 checks passed.
- Local document migration rehearsal: 18 checks passed after 59 canonical migrations.
- Git whitespace check passed.

## Production requirements

Review and commit this isolated change, then obtain production release authorization. Recheck the live webhook baseline against the reviewed release and its existing UUID/document/stale-handoff prerequisites. Deploy only `whatsapp-webhook` with its matching reviewed local dependency bundle. No migration, storage upload, configuration or frontend deployment is required. Perform no-send checks, then explicitly authorized real-phone QA for natural entry, invalid choices, a valid document selection and group-size handoff. Preserve the previous function bundle for rollback.

This task made no production calls or changes, sent no messages, and did not push or merge Git. Unrelated systems and source assets were untouched.
