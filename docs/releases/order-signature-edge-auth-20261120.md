# ORD-1065 signature email: Edge authentication correction

## Observed production evidence

- The one approved email attempt reached `send-order-signature` and returned HTTP 401 on 20 November 2026 at 16:40:25 Israel time. The delivery table has no row for revision `ec5ea25f-be4c-4ec0-8b09-38070aabf92e`. Do not retry based on that 401 without a new controlled decision.
- The active Edge Function has **Verify JWT with legacy secret** enabled. Its entrypoint additionally requires `Authorization` to equal `Bearer ` plus its managed `SUPABASE_SERVICE_ROLE_KEY`. The Vercel server previously passed its own `SUPABASE_SERVICE_ROLE_KEY` as both `Authorization` and `apikey`. The Edge request log confirms that the supplied credential is an HS256 `service_role` JWT with future expiration, and that both headers carried the same token. The full key was not disclosed. The log records a function execution ID and HTTP 401, but does not expose the response body or prove whether the gateway rejected the signature or the function rejected exact equality with its managed key. The failure is at this Vercel-to-Edge machine credential boundary, before an email claim; it is **not** caused by sending an `sb_secret_` key or by an expired JWT.
- The browser session was accepted by Vercel for staff reads, including the role-protected RPC and private PDF download. The PDF hash matched the stored version 1 hash. No new revision, invoice or payment was created.

## Candidate correction

- Vercel retains `SUPABASE_SERVICE_ROLE_KEY` for its database and private Storage client. Only signature email dispatch uses a separate `SUPABASE_EDGE_SERVICE_ROLE_JWT`, set to the **legacy service_role JWT for this exact Supabase project**. It is sent on both Edge headers. No browser receives this key.
- The server rejects missing, expired, malformed and non-service-role JWT configuration before contacting Edge. These local checks are a configuration guard, not signature verification. Supabase's enabled JWT gateway verifies the signature, and the Edge handler still checks exact equality with its managed service key. User access tokens are separately verified through `auth.getUser`, followed by the `order_signature_action('staff_read')` role check. No JWT check or permission is disabled.
- The new variable is required only for dispatch. Existing creation, history, private PDF access, and signing are unaffected. A deployment without the variable fails closed on delivery with `server_not_configured`.

## Release gate and controlled retry

1. With separate approval, set **only** Vercel Production `SUPABASE_EDGE_SERVICE_ROLE_JWT` from the project's **current** legacy `service_role` API key using the secret UI; do not copy it to source, logs, Preview or chat. Check that the key remains active and is valid for this project. Do not rotate or replace the existing Vercel database key. If the project no longer supports a legacy service_role JWT, stop for a separate architecture review.
2. Deploy the approved candidate without changing the Edge Function, database, JWT verification setting, payment gates or email credentials. Verify the deployment and domain. Before any document email, make a **non-delivery** auth probe to the Edge Function with `POST {}` using the dedicated JWT: expect HTTP 400 `invalid_request`. HTTP 401 means the credential still fails authentication; stop without retrying the email. A Preview deployment cannot send to Production in this test plan.
3. Re-read ORD-1065 history: version 1 must still be pending and current, its private unsigned hash unchanged, and no delivery attempt recorded. If there is any accepted or uncertain attempt, stop. Confirm recipient `ilyasov.daniel1@gmail.com` and obtain separate approval for **one** new email attempt using the existing version and a new request ID.
4. Send once. Verify the claim, final delivery state and version. Do not auto-retry an uncertain outcome. Ask the recipient to confirm arrival and link opening before any manual signing. After signing, verify the private signed PDF, version and audit history.

## Rollback

If the application fails after deployment, restore the prior Vercel deployment. Do not roll back signature tables or delete version 1. The new environment variable can remain unused by the prior deployment; remove it only as a separately reviewed secret change.
