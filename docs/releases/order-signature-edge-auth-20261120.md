# ORD-1065 signature email: confirmed 401 cause and corrected contract

> Superseded for release planning by `order-signature-complete-20261121.md`, which includes the separate historical-activity PDF correction and migration. Do not deploy this authentication change alone for the ORD-1065 acceptance test.

## Observed production evidence

- The one approved email attempt reached `send-order-signature` and returned HTTP 401 on 20 November 2026 at 16:40:25 Israel time. The delivery table has no row for revision `ec5ea25f-be4c-4ec0-8b09-38070aabf92e`. Do not retry based on that 401 without a new controlled decision.
- The active Edge Function has **Verify JWT with legacy secret** enabled. Its deployed `index.ts` reads `SUPABASE_SERVICE_ROLE_KEY` from the Edge runtime and tests exact string equality with the `Authorization` header. Its deployed `handler.js` returns `401 {"error":"authentication_required"}` when that comparison fails, **before reading the body**. The original Vercel request had both headers set to a nonexpired HS256 `service_role` JWT. The dashboard's current legacy service-role key has the same signature prefix. A controlled `POST {}` with the current dashboard key still returned this handler-specific 401. Thus the exact failing condition is the in-function equality comparison; the request did reach the function and did not reach user/role/RPC or delivery logic. The available evidence does not identify why the Edge runtime's managed key string differs from the presented header.
- The browser session was accepted by Vercel for staff reads, including the role-protected RPC and private PDF download. The PDF hash matched the stored version 1 hash. No new revision, invoice or payment was created.

## Candidate correction

- The previously proposed dedicated service-role environment variable is **withdrawn**. It would repeat the failing equality contract and has not been configured in Production.
- Vercel continues to verify the staff user's session through `auth.getUser` and checks the current database role through `order_signature_action('staff_read')`. It forwards that same user JWT to the Edge Function, with the project's public anon key on `apikey`; its service-role key remains confined to server-side database and private Storage operations.
- The Edge Function verifies the user JWT again through Supabase Auth, binds the authenticated user ID to `body.actorId`, and calls the existing role-protected `staff_read` RPC before any provider or delivery claim. Missing/expired sessions return 401; actor mismatch or role denial returns 403. The Supabase JWT gateway remains enabled. No new key, migration or permission grant is required.

## Release gate and controlled retry

1. With separate Production approval, reconfirm the live Vercel source, `send-order-signature` version, `verify_jwt=true`, `VITE_SUPABASE_ANON_KEY` availability, RPC grants and private bucket. Deploy **only** the corrected `send-order-signature` bundle, including its new `authorization.js`, then the exact reviewed Vercel application commit. Do not change environment variables, migrations, payment functions or other Edge Functions.
2. Before any document email, call the deployed Edge Function with a valid authorized test user's JWT and `POST {}`. Expect `400 invalid_request` and no delivery row. A missing/expired JWT must return 401; an actor mismatch in a synthetic mocked request must return 403. A service-role-only `POST {}` should now return 401 by design because there is no user session. Do not use a real revision or recipient for these probes.
3. Re-read ORD-1065 history: version 1 must still be pending and current, its private unsigned hash unchanged, and no delivery attempt recorded. If there is any accepted or uncertain attempt, stop. Confirm recipient `ilyasov.daniel1@gmail.com` and obtain separate approval for **one** new email attempt using the existing version and a new request ID.
4. Send once after that separate approval. Verify the claim, final delivery state and version. Do not auto-retry an uncertain outcome. Ask the recipient to confirm arrival and link opening before any manual signing. After signing, verify the private signed PDF, version and audit history.

## Rollback

If the application fails after deployment, restore the prior Vercel deployment. If the Edge function causes regression, redeploy its archived previous version; the old Vercel version and old Edge version must be paired. Do not roll back signature tables or delete version 1. No new environment variable exists to remove.
