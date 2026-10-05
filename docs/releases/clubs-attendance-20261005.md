# Controlled Clubs + Attendance release

Production baseline: dpl_DYRkLTXD8Qwo9Rc4XwLsSHTdYmKj.
Feature candidate: 470c59b (four commits above origin/main 2a0c7f5).
Deploy only the 184-file allowlist in the manifest, not this repository wholesale.
176 existing production files are unchanged. Only App/Layout/Clubs/Users change; four attendance modules are added.
The Git-only branch deployment guard is excluded from the deployment artifact.

## Recovery readiness
Completed physical backup 1877816756, 2026-10-05T17:26:58.949Z; PITR disabled. Backup restoration would affect the entire project and lose later writes; it is an emergency option, not the normal rollback.
Preflight: 1 club, 1 weekly rule, 2 instructors, 4 profiles; zero sessions, participants, memberships or attendance. Financial counts/fingerprints and schema definitions captured locally without row values.
Each migration is transaction-wrapped. On failure verify rollback before continuing. After commit retain operational/audit data; roll back application/Edge artifacts and disable new attendance access if required, rather than dropping tables.
Migration application records will be appended after each verified application. The historical project has no internal migration ledger; do not recreate one or rerun older migrations.

## Scope
No provider calls, financial writes, test users, instructor links, sessions or attendance marks are created by rollout smoke testing.

## Applied and verified

Frontend production: dpl_Di8vkxx243HJ276ctBHGiNS3Ujsy.
Release source commit: 7ca9ae0d64b9c74b6697a920e0ac58cdfcca36f8.
create-user: version 46, verify_jwt=true; all other Edge versions and secret digests unchanged.
Migration 001: applied once 2026-10-05T20:01:15.159Z; verified 2026-10-05T20:01:53.125Z.
Migration 002: applied once 2026-10-05T20:03:10.716Z; verified 2026-10-05T20:03:41.779Z.
Exact SHA256 values and object verification are in the adjacent rollout JSON. Do not rerun either migration.
Read-only authenticated page checks passed for Orders, Quotations, accounting, Pelecard page, Clubs and admin attendance. Instructor route is present and redirects the admin role as designed. Actual instructor functional QA remains manual.
Browser message-channel listener errors also occurred before deployment; no application load errors observed.
All 22 financial-table and existing operational-data fingerprints unchanged. New attendance/link/audit tables remain empty. No provider calls or QA records created.
