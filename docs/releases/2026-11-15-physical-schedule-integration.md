# Physical terminal schedule collection integration

This integration branch includes physical release `58299f2` and the latest check/cash collection commit `1423fdb`. The production source was reconfirmed as `01a4161` on 2026-11-15; this branch is not deployed.

## Shared contract

Schedule's `גבייה בקופה` action opens `/cashregister?orderId=<existing UUID>`. The order collection screen reads `get_payper_order_collection`, showing `totalMinor`, `paidMinor`, `balanceMinor`, `unresolvedPayment`, payments, and documents. With `VITE_PELECARD_PHYSICAL_ENABLED=true`, it links to `/payment/physical?orderId=<same UUID>`; when a payment is unresolved, that link remains available for read-only recovery. The physical screen calls the same status endpoint before preparing an intent.

Physical `prepareOrder` sends only order ID, requested amount, request key, and workstation code. Migration `202611150002` must follow `202611150001`; it locks the order, recalculates paid and outstanding amounts from the same payment and legacy sale ledgers, checks unresolved and ambiguous legacy payments, and freezes order, billing, VAT, and quote discount facts. Cashiers collect the full balance; admins may choose a partial amount. The physical reservation carries a correlated source-order snapshot so the new hosted-checkout guard permits this balance-checked path while still rejecting hosted payment after a non-card collection. The existing standalone `prepare` action remains available.

After EMV approval, the physical finalizer creates one sale and one payment link through the existing verified finalizer, then sets `שולם חלקית` or `פלאקארד` based on the remaining balance. It inserts a `source_blocked` Payper hold with payment, sale, and order IDs. Pelecard support confirmed that CT20 J4 automatically issues the Payper Invoice-Receipt. The physical path never calls `CreatePayperInvoice`; the ledger stays blocked until an existing document number, URL, amount, timing, transaction, and sale are verified through the physical reconciliation RPC. The public provider material reviewed so far does not identify a supported read-only J4 document lookup or email delivery proof, so those require a provider answer or documented manual evidence. The worker's claim-before-send and uncertain-result recovery remain unchanged.

## Release gates

1. Apply `202611150001` before `202611150002` under the user's recorded production approval only after a current backup and complete schema compatibility check. Both migrations passed isolated PostgreSQL fixture rehearsals; no new migration was applied during this preparation.
2. Keep `PELECARD_PHYSICAL_DISPATCH_ENABLED=false`, `PELECARD_PHYSICAL_ENABLED=false`, and `VITE_PELECARD_PHYSICAL_ENABLED=false` in production until an explicitly approved controlled window. Register `004` is the only enabled device; leave `003`, `005`, and `006` disabled.
3. Configure the local encrypted worker vault from `app/scripts/configure-physical-worker-local.ps1` with the dedicated physical J4 credentials, Session pooler URI, and downloaded CA. Require `ready:true`, `register004:true`, and `dispatchEnabled:false` from `physical-worker-local.ps1 -Mode check` before any payment preparation.
4. Pelecard confirmed automatic CT20 J4 Invoice-Receipt issuance. Obtain its supported lookup or a verified provider record for number, URL and delivery. Keep physical invoice dispatch blocked and reconcile the already-issued document; never call `CreatePayperInvoice` for the same charge.
5. Run a no-charge order reservation/cancel rehearsal after the integrated release is approved and deployed with financial dispatch off. A genuine charge still requires separate transaction-specific authorization.

The production deployment source, digital checkout credentials/endpoints, and continuous Payper settings were not changed by this integration work.
