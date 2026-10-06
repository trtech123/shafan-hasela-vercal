# Manual club session — scoped production fix

Baseline: production dpl_Di8vkxx243HJ276ctBHGiNS3Ujsy; reconciled release 8b37508.
User approved implementation, additive migration and controlled production deployment.

## Design
Use existing club_sessions, immutable schedule_snapshot, session audit and attendance RPCs.
Add one admin-checked SECURITY DEFINER create_manual_club_session RPC. Lock the club,
validate active club, instructor, Israel date bounds and same-day times, then insert
session and creation audit atomically. Existing unique club/date/start constraint
rejects retries, concurrent creation and duplicates of generated/cancelled sessions.
No financial joins, mutations or provider calls. No existing attendance RPC changes.

Add + מפגש חדש to admin attendance with an accessible responsive form. Default club,
Israel today and club instructor; times require explicit entry. Creation occurs only
on explicit submit. Refresh the requested date and show the same existing session workflow.
On uncertain failure retain the form and refresh; a retry cannot duplicate a session.

Remove only obsolete Clubs iCredit enrollment/finalization controls and provider-linked
attendance panel. Update registration copy. Keep backend provider code and historical data.

## Verification and release
1. Capture production source hashes, schema markers, backup metadata and aggregate data fingerprints.
2. Write failing UI/DB tests; implement migration, form and narrow cleanup.
3. Run existing attendance/auth, Clubs, Orders/payment/accounting tests; compare baseline failures.
4. Rehearse all attendance migrations plus new migration against captured production schema.
5. Build allowlisted artifact from current production, replacing only approved files.
6. Commit scoped code, apply migration once, verify bodies/grants and unchanged data.
7. Deploy hash-verified artifact, preserve all runtime settings, push release record.
8. Read-only production smoke only; never create the user's QA session.
