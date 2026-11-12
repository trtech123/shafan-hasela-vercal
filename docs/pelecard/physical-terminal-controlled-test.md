# Physical Pelecard CT20: deployment and controlled-test checklist

Development branch: `feature/pelecard-physical-cloud-terminal`. This document does not authorize a financial request, production migration, invoice, or deployment.

## Runtime boundaries

- The browser's separate `/payment/physical` page calls only `/api/pelecard-physical` for authenticated device listing, intent reservation, status, and read-only EMV verification. Vercel's new physical API has a 30-second limit and never sends J4.
- `npm run physical:worker` runs as a dedicated long-lived Node process. It discovers up to 40 unresolved intents, atomically claims each reserved intent, waits up to 300 seconds for J4, and independently checks EMV status. It recovers claimed/uncertain intents by lookup only. It does not resend them.
- The worker process needs at least 330 seconds of uninterrupted execution and outbound HTTPS to `gateway21.pelecard.biz`. Do not run it as a 30-second Vercel function. A continuously running process must be provisioned and monitored before the first test.
- `app/Dockerfile.physical-worker` packages only the worker runtime and its locked production dependencies. Build with `docker build -f app/Dockerfile.physical-worker -t shafan-pelecard-physical-worker app`. No image was built or deployed in this session because Docker is unavailable in the workspace.
- The container health check runs `node scripts/physical-terminal-worker.mjs --check`. This checks the physical database RPC and enabled assignments only; it never calls `DebitRegularType`. For the first test, require `ready: true` **and** `register004: true`. Health does not prove device-to-provider routing or credential authorization.
- The host must keep one worker process running continuously, permit at least 360 seconds of shutdown grace for an in-flight J4 call, inject secrets at runtime, and retain structured logs. It needs TLS access to the physical database and HTTPS egress to gateway21; if Pelecard requires IP allowlisting, provision a stable egress IP before testing. If a process dies during a charge, its claimed intent remains locked for read-only reconciliation. Do not schedule this worker as a short request or cron job.
- The local SQL migrations create the physical device settings, one-shot intent/register lock, idempotent sale finalization, physical UID storage, Payper billing snapshot, and a blocked entry in the existing one-document ledger. They have **not** been applied to Production.

## Separate physical configuration

Server and worker secrets (supply from a secret manager; never place real values in the browser or repository):

| Variable | Use |
| --- | --- |
| `PELECARD_PHYSICAL_TERMINAL` | Full terminal `2814926015` |
| `PELECARD_PHYSICAL_USER`, `PELECARD_PHYSICAL_PASSWORD` | Pelecard credentials explicitly authorized for card-present J4 and EMV lookups; **do not copy the hosted checkout credentials without provider confirmation** |
| `PELECARD_PHYSICAL_DATABASE_URL` | Dedicated physical backend PostgreSQL connection, with access limited to the physical RPCs and catalog reads |
| `PELECARD_PHYSICAL_DATABASE_CA` | PEM CA certificate used to verify the database TLS connection |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Existing general Supabase identity service for validating staff bearer tokens; no Pelecard digital terminal setting is read |
| `PELECARD_PHYSICAL_ENABLED` | Physical reservation API gate, default off |
| `PELECARD_PHYSICAL_DISPATCH_ENABLED` | Independent financial J4 worker gate, default off |
| `PELECARD_PHYSICAL_WORKER_MAX_MS` | At least `330000` when dispatch is enabled |
| `VITE_PELECARD_PHYSICAL_ENABLED` | Browser visibility flag, default off |

The administrator assigns an enabled device to an active named cash register on `/physical-terminal-settings`. The cashier chooses that workstation once; the POS remembers the choice in this browser and displays its configured device and three-character register. With several devices and no saved choice, the cashier must choose explicitly. `004` routes to the CT20 photographed by the client, as confirmed by Pelecard support.

## Provider confirmations required before the first charge

1. Confirm which separately supplied user/password can call `DebitRegularType`, `CheckGoodParamXEMV`, and `GetTransDetailsEMV` for `2814926015` / `004`, and whether merchant J4 activation or IP allowlisting remains required.
2. Confirm whether the CT20 Pelecard app 3.1.6 uses a device-native cloud link or still requires the Cloud Agent described in the older Appendix D. If an agent is required, confirm its installation location and online status.
3. Supply redacted J4 and EMV lookup examples for approval, decline, device offline, and timeout. The current parser requires exact terminal, amount, ParamX, UID, register `termNo`, Shva approval, and approval ID before finalizing. Unknown shapes remain uncertain.
4. Confirm the physical J4 transaction's `trxRecordId` and `Uid` mapping for `CreatePayperInvoice`, card-present eligibility, and Payper credential/activation scope. Until then, the physical sale's ledger entry remains `source_blocked`; no physical invoice API request is made.

## First controlled test, after explicit authorization and deployment approval

1. The CT20 currently shows `מוכן להפעלה`, terminal `2814926015`, register `4`, app version `3.1.6`, and Ethernet connectivity; the earlier connection error has disappeared. This establishes local device readiness, not J4 credential authorization or Cloud Agent applicability. If there is a cloud or communication status screen, send its screenshot with secrets and card details obscured; menu names vary by app version, so inspect the visible menu before choosing a path.
2. After separate migration and deployment approval, apply the physical migrations, configure the separate secrets, assign register `004` to the test workstation, and enable that device. Keep `PELECARD_PHYSICAL_DISPATCH_ENABLED=false` throughout this preparation.
3. Start the long-running worker with dispatch off and run `npm run physical:check` (or the container health check). Require `ready: true`, `register004: true`, and `dispatchEnabled: false`. For a no-charge rehearsal, enable the separate physical reservation and browser visibility flags, confirm the POS can list `004`, reserve a test cart without a J4 request, and **cancel that still-reserved intent** to release the register before the financial test.
4. After explicit authorization for a **specific amount and payment method**, enable the physical dispatch gate for the controlled window. Reserve exactly one intent from the POS. Do not click a second payment button if the terminal or browser is slow.
5. Report the device's displayed amount, card-presentation prompt, result message, and the POS state. An uncertain state stays locked while the provider result is reconciled; do not retry the charge blindly.
6. Verify the single sale and the blocked physical Payper ledger record. Do not issue an invoice until the mapping and eligibility in item 4 are confirmed and a separate physical invoice adapter is approved.
