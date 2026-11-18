# WhatsApp document delivery: live source parity

Read-only inspection on 2026-11-18 found that Production's `whatsapp-webhook` Edge Function already contains the private document-delivery implementation. This branch starts at the protected deployed application source `73690eee338b400bd9310e8fb283806852f43f29` and records the **downloaded live Edge Function source**, rather than replacing it with the older `main` implementation. This is source reconciliation only: do not redeploy this function as part of a normal application release.

## Evidence and limits

- Supabase's live Code view supplied the ZIP. Its 21 entries were checked for path traversal and extracted only into this branch. Normalized LF SHA-256 hashes of the extracted entry, assets manifest, delivery module, event processor, repository, state machine and sender matched the corresponding live Code view files.
- The live manifest enables 14 assets. Read-only `storage.objects` inspection found all 14 keys in the private `chatbot-assets` bucket, with all declared sizes matching. The stored bytes were not downloaded, so their SHA-256 values have **not** been independently confirmed. The live loader verifies checksum, size, MIME type and file signature before sending.
- The live `claim_bot_attachment(uuid)` RPC exists, is callable by `service_role` but not `authenticated`, and atomically requires `attachment_attempted_at IS NULL`. A claimed attachment is never automatically retried after an uncertain provider response. The live bundle has the corresponding claim-before-send and handoff behavior.
- Edge secret names for Meta credentials exist. Values and provider delivery were not tested. No customer message or accounting document was sent.
- The live bundle differs from `origin/main` in the manifest, event processor, repository, state machine and sender. A future Edge release must reconcile those differences deliberately; copying `origin/main` would regress currently deployed behavior.

## Verification

`chatbotDeployedBundle.test.js` uses synthetic records and a mocked sender. It checks manifest isolation, self-contained imports, claim-before-send, duplicate claim rejection, uncertain delivery handoff and checksum rejection. Existing webhook and chatbot tests were run alongside it. No live provider endpoint was contacted.

**Release status:** GO for source preservation in Git; NO-GO for a Production Edge redeployment without a separate Preview and provider acceptance plan. This branch does not change the protected Production app, payment configuration or the active CT20 investigation.
