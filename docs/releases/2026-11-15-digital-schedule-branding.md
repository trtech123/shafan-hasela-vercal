# Digital schedule collection and display name candidate

Base: fetched `integration/physical-schedule-collection-20261115` at `b243aac`, retaining its independent digital option. Last verified live Vercel deployment is `dpl_C7GS9MtWGnc7A7GkZQvfU4Yus1fL` (Ready, production alias), built from the previously recorded `4d509b0`. No production write was performed for this candidate.

## Release scope

- Apply **only** `202611150101_digital_order_payment_eligibility.sql` after explicit approval. It adds the digital eligibility and service-description functions and tightens only the existing order-linked hosted reservation. It does not alter the standalone checkout, physical/non-card contracts, provider credentials, callback verification, Payper worker, or financial feature gates.
- Deploy the updated `pelecard-order-payment` Edge function after the migration, then the Vercel frontend. The new status path calls the new RPC, so do not deploy that Edge function before the migration. Physical, cash and check gates remain OFF.
- The current hosted order flow remains full-balance only when there is no prior collection. Historical partial payments cannot open a full-original-amount hosted charge. Physical and non-card balance collection remain separate releases.
- The payment billing snapshot is written in the reservation transaction and remains immutable. The existing verified finalizer and continuous Payper worker use it for the official Invoice-Receipt. The local `RCP-...` is an internal sale confirmation.
- Displayed business branding uses the existing `BRAND.name` value “שפן הסלע” in the register confirmation, printout, register heading, login, layout and quotation presentation. Legal company and Payper account identities are untouched.

## Controlled test boundary

The read-only production check found no Daniel customer card. Six legacy Daniel-named orders have no customer snapshot or VAT. `ORD-1057` is the small future-dated proposal only after the exact corrections in [the workflow action map](../screens/digital-schedule-collection.md). No production customer/order edit, hosted initialization, payment, invoice or migration application is part of this candidate. A live transaction needs separate approval for the exact order and amount.
