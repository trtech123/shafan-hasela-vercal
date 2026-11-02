# Cash Register hosted Pelecard integration

## Source and ownership

Start from isolated `42f47f0`. Keep the linked-order route to the existing order review page. The standalone path has no `orders` row. Its source is a private cart intent keyed by a new payment UUID. Never call the disabled `pelecard-initiate` function.

## Implementation sequence

1. Add focused contract tests for the cart price and VAT rules, role checks, immutable reservation, provider verification, repeated finalization, and Payper source selection. Run them red before implementation.
2. Add a prospective SQL migration for private cart intents and hosted attempts. The reservation RPC reads current active catalog prices, computes integer agorot, applies the owner's confirmed regular VAT policy, freezes item descriptions and billing, and creates one `payment_transactions` row. The browser supplies item IDs and quantities only; an authorized admin discount is computed on the server. Manual price override stays unavailable for hosted payment; the current manual tenders remain intact.
3. Add a dedicated POS Edge function and signed Node gateway adapter path. Node uses the existing live-only Pelecard credentials and TLS transport. One database claim permits one provider initialization. Save the hosted session before returning its URL. Callback/return data is a locator; GetTransaction plus confirmation-key correlation provide financial evidence.
4. Finalize in one database transaction: lock the intent and payment, check the verified provider state and exact stored amount, insert one `sales` row, attach it to the payment, and let the existing reporting read `sales`. Repeat callbacks return the same receipt. Declines, cancellation, transport ambiguity and expiry never create a sale or authorize automatic retry.
5. Extend the disabled Payper ledger to accept a sale-only source. Freeze a private billing snapshot and descriptions, retain the same activation cutoff, one-document reservation, uncertain-outcome hold, and admin-only document view. Incomplete billing creates a manual-accounting obligation.
6. Wire the Cash Register product and service catalog, hosted review screen and return route. Use the order page for a linked saved order and its actual remaining balance.
7. Run SQL, Edge, Node, UI regression tests, build and typecheck. Compare TypeScript diagnostics to approved baseline. Review the isolated diff and commit. No production change or payment during this work.

## Deployment gate

Review the release commit, apply only its prospective migration, deploy the Node adapter and Edge functions, run non-charging smoke tests, and separately authorize the real ₪1 payment. Payper remains disabled until the later supervised invoice authorization.
