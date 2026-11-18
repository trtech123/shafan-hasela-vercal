# Payment/restoration compatibility boundary — 2026-11-18

The restoration candidate descends from deployed Production source `73690eee338b400bd9310e8fb283806852f43f29`. The separate working tree `workstream/pelecard-test-isolation` was read only. At audit time its HEAD was `b0989e591919edab27cddd9621587a5403dd38f0`, with 213 changed/untracked paths. It is not a stable integration input. ORD-1062 was not queried or modified.

Comparing that tree's **tracked uncommitted paths** with the restoration candidate's changed paths found ten overlaps:

| Files | Required reconciliation |
|---|---|
| `app/src/App.jsx`, `app/src/components/Layout.jsx`, `app/src/components/Layout.test.jsx` | Merge route and navigation additions individually. Keep all current cashier/payment routes and the restored role-specific screens. Re-run role and payment-route tests. |
| `app/src/pages/Login.jsx` | Preserve the restored asynchronous profile/login redirect fix while reviewing any payment-workstream authentication change. |
| `app/src/pages/Orders.jsx` | Compare order collection, scheduling and reconciliation UI with restored document/signature controls. Do not replace payment state handling. |
| `app/package.json`, `app/package-lock.json` | Reconcile dependency additions and lockfile from a clean install; do not substitute an older lockfile. |
| `app/vercel.json` | Retain manual deployment control, existing function limits, queue triggers and cron; review payment-workstream changes explicitly. |
| `supabase/functions/whatsapp-webhook/index.ts`, `sender.js` | Keep the live chatbot document-delivery bundle and review new payment-related edits module by module. Never redeploy the webhook as a side effect of app release. |

Seventeen currently **untracked** payment-worktree paths also exist in the restoration candidate: voucher components/helpers and tests; `Customers.jsx`; `Login.test.jsx`; Pelecard transaction screen/helper and tests; and `send-quote-email/index.ts`, `send-quote-whatsapp/index.ts`. Their names do not establish equivalence. Compare contents and tests after the payment workstream commits them; avoid overwriting either version. A normal merge before then could silently discard untracked files or produce a false clean result.

## Safe later integration sequence

1. The payment coordinator finishes ORD-1062 reconciliation and commits a verified payment branch. Record the exact commit, live deployment SHA and whether any DB/Edge/environment change occurred.
2. Create a **new** integration worktree at the verified protected Production baseline or its approved successor. Bring in the operational restoration group first, reviewing the ten tracked overlaps and seventeen untracked-name collisions against the now committed payment diff. Use explicit file-level merges and tests, not an entire-tree preference strategy.
3. Run customer/attendance role tests, order/POS/cash/hosted/J4/Payper regression, schema preflight, isolated staging browser acceptance, lint, build and deployment packaging checks. Confirm chatbot bundle parity and Vercel gates.
4. Integrate signed documents, communication, vouchers and read-only Pelecard administration as independently gated groups after their separate approvals. Never activate a financial or delivery feature merely because its code merged.

No payment-workstream code was changed, merged, pushed or deployed in this audit.
