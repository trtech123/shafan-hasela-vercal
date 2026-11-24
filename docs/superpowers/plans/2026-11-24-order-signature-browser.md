# Order Signature Browser Implementation Plan

**Goal:** Prepare an order confirmation after save, present a browser form, and safely retain completed contact details with the signed version.

**Architecture:** Reuse the existing private revision and signing API. Add a service-only immutable response record for completed details and deterministic customer/lead linkage; leave historical records untouched.

**Tech Stack:** React, Vite, Vitest, Vercel Node API, Supabase Postgres.

## Tasks

- [x] Add failing tests for post-save preparation without delivery; implement and verify.
- [x] Add failing tests for browser summary and missing-detail form; implement and verify.
- [x] Add failing tests for server validation, replay and response persistence; implement and verify.
- [x] Add additive response-table migration with service-only RPC and unique provenance matching; rehearse on local database.
- [x] Label the old PDF delivery explicitly, make the signing email link-first, and verify no document is sent automatically.
- [x] Run focused tests, lint, build and migration rehearsal; inspect diff for payment, lead-ingestion and legacy-document regressions.

## Release sequence (separate authorization)

Read-only Production preflight and backup, apply only reviewed migration, verify counts/grants, deploy only required server/Edge and Vercel app versions, perform no-send probes and UI checks, then separately authorize a real message. Roll back app and Edge together if their authentication contracts differ. Never rewrite signed evidence or restore the database wholesale over newer lead data.
