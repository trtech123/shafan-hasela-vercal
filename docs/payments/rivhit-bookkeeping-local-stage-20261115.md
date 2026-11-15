# Rivhit bookkeeping: local stage and release gates (2026-11-15)

## Scope and evidence

The isolated branch `plan/rivhit-sync-20261115` starts from Vercel Production deployment
`dpl_JCKPP1pnMUDgWv4RqYRNijyM2Gjm`, Git commit
`01a416175c17b027660c1f77d8e4ddcf3fafed46`. The active Payper worker
v82 `outcome.ts` was restored in commit `c9e1fc255b105ec0833820ff0c622f8c83d4777c`.
The new bookkeeping module imports no legacy Rivhit, payment, Pelecard, or Payper
runtime source. Nothing in this stage was deployed, migrated, or dispatched.

## Production connection check

The Production secret inventory confirms `RIVHIT_API_TOKEN` exists, but the
Supabase secrets API returns a digest rather than the plaintext value. The
available deployed endpoints do not expose safe read-only metadata/chart/report
operations with that secret. Therefore token validity, company identity,
account cards, sort codes, journal/report access, and the presence of document
200002 in Rivhit are **unverified**. The official read-only endpoints to run in
a future authorized server-side probe are `Company.Details`, `Customer.List`,
`Accounting.SortCodeList`, `Accounting.JournalsReport`, and, if appropriate,
`Accounting.PnLReport` / `Accounting.VatReport`. A secret holder must execute
these without returning the token or sensitive rows to logs. The existing
Production Payper ledger establishes a successful Payper document 200002 for
the linked Production payment, 4.00 ILS; it proves no
Rivhit journal posting.

## New local components

- `rivhit_bookkeeping_sources` freezes Payper source identity, document number,
  payment link, amount, and source hash. Uniqueness is per accounting namespace,
  source system, and provider document ID.
- `rivhit_bookkeeping_legs` freezes each proposed journal leg, mapping revision,
  approval reference, request hash, and `request_reference`. Unique source/leg/
  correction and request reference constraints reject duplicates. Initial status
  is `held_mapping`. No enqueue trigger exists yet.
- A service-only RPC claims a leg once and records `dispatch_started_at` before
  an HTTP call. Completion uses a fencing token and stores Rivhit year/month/line;
  uncertain results are held for reconciliation. A claimed leg cannot be
  reclaimed, even after a timeout. This favors manual recovery over duplicate
  accounting entries.
- The worker requires a service credential, `RIVHIT_JOURNAL_ENABLED=true`, an
  explicit approved mapping JSON, and a matching mapping version, approval
  reference, and accounting namespace in the queued leg. Defaults stay disabled.
  The provider adapter calls only `Accounting.AddJournal`; it never calls
  `Document.New` or `Receipt.New`.
- No accounting mapper, automatic enqueue, historical backfill, or real dispatch
  is implemented. These depend on Anat's approved entries and live API checks.

## Production source parity gate

Active Edge bundles embed different historical versions of shared modules:

| Shared file | Distinct active versions | Bundle grouping (SHA-256 prefix) |
|---|---:|---|
| `payment-edge-runtime.ts` | 2 | payment worker `097236865FF5`; Pelecard callback `D302D9B688D1` |
| `payment-store.ts` | 2 | payment worker `422815276948`; callback `67D3DA0D356F` |
| `payment-types.ts` | 2 | payment worker `ADA628B5ECC0`; callback/live feedback `4C8471D88862` |
| `rivhit/client.ts` | 3 | payment worker + legacy Rivhit `400BF08F4BD1`; callback `0BAF2921B4F9`; immediate accounting `408D6F2D6B93` |
| `rivhit/supabase-repository.ts` | 2 | payment worker + legacy Rivhit `AE714A97BD26`; callback `C78A76CBE470` |
| `rivhit/workflow.ts` | 2 | payment worker + legacy Rivhit `54014C205F72`; callback `F3F93DC4E15B` |

Resolution for this stage: the new worker has its own `_shared/rivhit-bookkeeping`
module and cannot bundle any of these conflicting files. Before deploying an
existing Edge function in the future, compare its entire shared dependency
bundle against its currently deployed source and reconcile intentional changes
with contract tests. Do not use one historical shared copy as a blanket
replacement for all functions.

## Migration history gate

The current repository has two distinct files each for versions `202611120001`
and `202611120002`: physical terminal settings / safe order deletion, and
archive settled history / physical payment intents. Their SHA-256 prefixes are
`38E5A04FEC406A49` / `9C6FFDA529089668`, and
`76B3D4153459C878` / `007D8CBE9489113E`, respectively. The new migration
uses the unique version `202611150001`. Production migration history and schema
must be compared before any release. Resolve duplicate version filenames in a
separate reviewed migration repair after confirming which files ran; do not
rename or replay them blindly. This is a **release blocker**.

## Accountant decisions for the first pilot

For Payper document 200002, Anat should confirm:

1. The exact journal entry or entries (debit/credit accounts, sort codes, VAT
   split, customer/clearing account, card payment route), based on the actual
   Payper document and Rivhit chart. A concrete balanced example is required.
2. Reference/recognition date, accounting period, rounding, and the report in
   which the entry must appear.
3. Whether 200002 has already been entered manually or by another import, and
   how an existing entry should be identified.

The account IDs and sort codes should be read through the official API first;
they are requested from Anat only if read-only API access cannot be granted.
The live company identity and Online-account entitlement must also be checked
before mapping approval. No real posting is allowed until a separate explicit
authorization for the pilot.
