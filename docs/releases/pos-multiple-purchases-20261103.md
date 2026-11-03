# POS purchase-scoped checkout release

Source: the commit containing `202611030004_pos_checkout_scope.sql` and the
checkout-key correction, based on `629e7da3e5d22aca05151eb27108321e78b45d00`.

## Disabled deployment

1. Record the production Vercel deployment, `pelecard-pos-payment` version,
   Payper and pending-recovery controls, POS gates, and the two old pending
   payment IDs. Do not resolve or backfill those payments.
2. With Vercel and Supabase POS gates OFF, apply only
   `202611030004_pos_checkout_scope.sql`. Its baseline guard must pass. Verify
   the broad operator lock is absent and the original request-key, payment,
   session, sale, and invoice uniqueness controls remain.
3. Deploy `pelecard-pos-payment` from this source commit, including its safe
   error mapping. Deploy the Vercel app from the repository root because the
   project Root Directory is `app`. Build an unaliased candidate and run
   authenticated Admin and Cashier non-charging checks. Promote that candidate
   only if the build, safety gates, and app checks pass.
4. Confirm the prior payments are unchanged, no new charge or document exists,
   Payper dispatch/wake/scan/email and pending recovery remain OFF, and no
   recovery schedule is active.

## POS activation authorized by owner

Set `PELECARD_POS_PAYMENTS_ENABLED=true` in Supabase Edge Secrets and Vercel
Production, then redeploy the approved app source for the Vercel value to take
effect. Confirm both effective gates and perform a non-charging cart preparation
with a distinct checkout key. Do not enter a card or invoke Payper. If any
check fails, return both gates OFF, redeploy the last safe Vercel source, and
preserve the migration and all pending payment evidence.

Pelecard code 173 is provider-level same-card/same-amount short-interval
protection. A new local checkout UUID does not override it. Confirm the
merchant policy with Pelecard before claiming rapid identical-card payments
will all succeed; a 173 response remains unresolved and requires reporting.

## Recovery

Immediately turn OFF both POS gates and redeploy the same approved Vercel
source if initiation must stop. Leave the migration installed; do not undo
already persisted intents. Restore the prior app and Edge snapshots only with
the gates OFF and reconcile any in-flight provider session by its own IDs.
