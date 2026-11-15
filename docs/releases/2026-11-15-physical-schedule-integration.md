# Physical terminal schedule collection integration

This integration branch merges physical release `58299f2` with the check/cash schedule collection commit `8c772dc`. Production remains on `01a4161`; this branch is not deployed.

## Shared contract

Schedule's `גבייה בקופה` action opens `/cashregister?orderId=<existing UUID>`. The order collection screen reads `get_payper_order_collection`, showing `totalMinor`, `paidMinor`, `balanceMinor`, `unresolvedPayment`, payments, and documents. With `VITE_PELECARD_PHYSICAL_ENABLED=true`, it links to `/payment/physical?orderId=<same UUID>`; when a payment is unresolved, that link remains available for read-only recovery. The physical screen calls the same status endpoint before preparing an intent.

Physical `prepareOrder` sends only order ID, requested amount, request key, and workstation code. Migration `202611150002` must follow `202611150001`; it locks the order, recalculates paid and outstanding amounts from the same payment and legacy sale ledgers, checks unresolved payment attempts, and freezes order, billing, VAT, and quote discount facts. Cashiers collect the full balance; admins may choose a partial amount. The existing standalone `prepare` action remains available.

After EMV approval, the physical finalizer creates one sale and one payment link through the existing verified finalizer, then sets `שולם חלקית` or `פלאקארד` based on the remaining balance. It inserts a `source_blocked` Payper hold with payment, sale, and order IDs. The new migration does not issue an invoice or alter hosted checkout or continuous Payper configuration. The worker's claim-before-send and uncertain-result recovery remain unchanged.

## Release gates

1. Review both migrations together and apply `202611150001` before `202611150002` only under separate production migration approval. No new migration was applied during this preparation.
2. Keep `PELECARD_PHYSICAL_DISPATCH_ENABLED=false`, `PELECARD_PHYSICAL_ENABLED=false`, and `VITE_PELECARD_PHYSICAL_ENABLED=false` in production until an explicitly approved controlled window. Register `004` is the only enabled device; leave `003`, `005`, and `006` disabled.
3. Configure the local encrypted worker vault from `app/scripts/configure-physical-worker-local.ps1` with the dedicated physical J4 credentials, Session pooler URI, and downloaded CA. Require `ready:true`, `register004:true`, and `dispatchEnabled:false` from `physical-worker-local.ps1 -Mode check` before any payment preparation.
4. Obtain Pelecard confirmation whether CT20 J4 automatically generates a Payper Invoice-Receipt and how to retrieve its number and URL. Keep physical invoice dispatch blocked. If a matching document already exists, use the accountant-approved reconciliation path; do not call `CreatePayperInvoice` for the same charge.
5. Run a no-charge order reservation/cancel rehearsal after the integrated release is approved and deployed with financial dispatch off. A genuine charge still requires separate transaction-specific authorization.

The production deployment source, digital checkout credentials/endpoints, and continuous Payper settings were not changed by this integration work.
