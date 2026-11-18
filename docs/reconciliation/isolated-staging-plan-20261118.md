# Isolated staging plan and acceptance gate — 2026-11-18

## Current state

No cloud staging resource has been created, and no Vercel Preview deployment was made. The existing Vercel project shares five Production Supabase/Meta variables with Preview. Its `app/vercel.json` also contains a physical-worker cron. Reusing that project for acceptance is prohibited. Docker and Supabase CLI were not available on this workstation; the local PGlite and blocked-network Chromium rehearsals are the available isolated tests.

## Exact resources requiring approval

1. One **new Supabase project** in an approved region and organization, with an empty database, Auth, private Storage and Edge Functions. Never restore Production data or clone Auth users. Create only three test users (`staging-admin@example.test`, `staging-cashier@example.test`, `staging-instructor@example.test`) using admin creation with confirmed email and synthetic passwords; no invitation or confirmation email. The test domain is non-routable. Do not enable SMTP, Meta, Pelecard, Payper, iCredit or Rivhit secrets. Apply only the repository schema to this new project after a staging-only migration rehearsal; then run the guarded seed. Do not use `supabase/seed.sql`, which contains older sample sales and promotes an arbitrary profile to admin.
2. One **new Vercel project**, separate from `prj_6rvjmBAfEUpym5E4JwVPut1HiXQC`, linked to the same source repository with Root Directory `app`, Vite framework, and automatic Git deployment disabled by the existing `app/vercel.json`. Do not attach the Production domain or shared integrations. Manual Preview only. Copy `app/.env.staging.example` into private configuration with the new Supabase URL/public key and all listed gates `false`. Add no server service-role key or direct database URL to Vercel; server APIs requiring them must remain unavailable in this first staging phase. Restrict staging access to authorized testers.
3. A separate staging-only direct Postgres connection string for one-time schema/seed setup, stored outside Vercel and never committed. `app/scripts/seed-staging.mjs` accepts only `db.<approved-ref>.supabase.co` and uses TLS verification. It requires the three synthetic Auth users to exist. The seed writes only synthetic customer, club, instructor, membership, session and roster records. It creates no orders, sales, payments or documents.

The Supabase pricing page currently lists a Free tier with up to two active projects, while additional projects under a paid organization start at approximately **US$10/month** of compute, billed by active hour; other usage can add charges. The actual available Free slots and billing organization must be checked before creation. Vercel Pro uses a shared usage allowance/credit and can bill on-demand usage beyond it; no fixed per-project charge for an ordinary additional project was confirmed. These are possible costs, **not authorization to provision**. Sources: [Supabase pricing](https://supabase.com/pricing), [Supabase billing FAQ](https://supabase.com/docs/guides/platform/billing-faq), [Vercel Pro billing](https://vercel.com/docs/plans/pro-plan).

## Fail-closed setup and checks

1. Confirm the new project IDs and billing estimate before creating anything. Keep Production project IDs `divzxsynczeifkpnpupl` and `prj_6rvjmBAfEUpym5E4JwVPut1HiXQC` out of all staging settings.
2. Apply the schema to the **empty staging database only**. The 102 migration files have passed local PGlite rehearsal, but the actual Supabase migration tool and Edge deployment packaging have not yet been exercised. Validate schema/migration history and stop on a mismatch. Do not copy Production rows, documents, backups or secrets.
3. Create the three synthetic Auth accounts without sending messages, then run `node app/scripts/seed-staging.mjs` with the staging-only direct database URL in the local process. The runner checks the project ref, direct DB host and closed gates before connecting. Run `node app/scripts/rehearse-staging-seed.mjs` locally first; it tests a denied unguarded seed, idempotency, and Admin/Cashier/Instructor RLS/RPC boundaries.
4. Link a **separate checkout** to the new Vercel project. Pull/inspect only that project's Preview variable names and values into a private local file. From the repository root run `node app/scripts/staging-isolation.mjs`; it compares `.vercel/project.json` to the approved staging ID, rejects the Production Supabase ref, rejects payment/messaging credentials and requires each financial gate to be explicitly false. Do not print or commit secrets. Inspect the deployed environment again before any Preview URL is opened.
5. The existing physical-worker cron remains in `app/vercel.json`. In the new staging project it must find all gates closed and no provider/database credentials. Confirm its disabled response in a read-only log review. A separate staging-only deployment configuration that removes the cron would be safer for longer-lived staging; do not alter the Production deployment file for this purpose without a reviewed packaging step.

The staging isolation script is a **preflight**, not a runtime firewall. Its checks must be paired with the separate project, restricted access, no Production credentials, and a post-deploy environment inspection. It deliberately rejects a Vercel service-role key, so server-rendered order confirmation cannot be tested in the first frontend-only phase. A later document-API staging phase would need a separately reviewed staging-only service-role design.

## Acceptance matrix after resource approval

| Actor/feature | Synthetic acceptance | No-go condition |
|---|---|---|
| Admin customers | Create, edit, search, archive; confirm version conflict and role boundary | Any access to Production data or unexpected email |
| Cashier customers | Create/edit/search, no archive or admin attendance route | Archive succeeds or admin-only data is visible |
| Linked Instructor | See own sessions/roster, mark attendance, cannot see customers or other instructor roster | Unlinked/other instructor can mark or view records |
| Admin club | Create manual session, mark/correct attendance, audit/history | Cashier can invoke admin RPC or marking duplicates unexpectedly |
| Signatures/private PDF | Synthetic order only, authorized signer token, private PDF, immutable revision, download restriction | Storage publicly readable, revision replacement or repeat send |
| Quote/order delivery | Mock/sink provider only, claim/finish history, duplicate suppression and uncertain outcome | Any real email/WhatsApp recipient or automatic resend |
| Pelecard admin | Mocked read-only endpoint only; no ORD-1062 lookup | Any charge/refund/cancel or live provider request |

Signature and communication acceptance require a second phase with staging-only Edge Functions, private bucket and inert provider adapters or sink endpoints. Do not copy Production Meta/Gmail secrets. A real customer delivery is outside this workstream. The live chatbot Edge bundle must not be redeployed.

## Release result

Local acceptance is supported by the existing blocked-network Chromium script, mocked Edge tests, and the new PGlite role rehearsal. **Remote Preview and Production remain NO-GO** until the new resources are approved, created and verified. No Production migration, payment gate, Edge secret, RLS policy or data was changed.
