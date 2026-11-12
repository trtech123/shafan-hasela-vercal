# Physical terminal release candidate

The latest inspected Vercel production deployment `dpl_EZDW6gGSEExSHQMyUAW9S8kUgMUX` records CLI source commit `e89b564a8900b56c7259499c5150c6de24a19a75` on `fix/order-deletion-release-20261112`. The isolated release branch `release/physical-terminal-prep-20261112` starts from that exact commit and adds the physical-terminal commits. A diff against the production source confirms no change to `app/server/pelecard-live`, digital Pelecard API entrypoints, or the continuous Payper worker/configuration.

## Deployment gates

1. Pelecard confirms a username/password authorized for card-present J4 and EMV lookups on terminal `2814926015`, shop `004`. Do not infer this from the digital hosted checkout secret names.
2. Apply the separately approved physical manual reconciliation migration `202611120003`. Migrations `202611120001` and `202611120002` are already applied; no production physical payment intents exist yet.
3. Configure separate production server variables `PELECARD_PHYSICAL_TERMINAL=2814926015`, `PELECARD_PHYSICAL_USER`, `PELECARD_PHYSICAL_PASSWORD`, `PELECARD_PHYSICAL_DATABASE_URL`, `PELECARD_PHYSICAL_DATABASE_CA`, `SUPABASE_URL`, `PELECARD_PHYSICAL_ENABLED=false`, and `PELECARD_PHYSICAL_DISPATCH_ENABLED=false`. The existing `SUPABASE_SERVICE_ROLE_KEY` is available. The browser flag `VITE_PELECARD_PHYSICAL_ENABLED` remains false for initial deployment. Never overwrite digital Pelecard or Payper variables.
4. Review and approve deployment of the exact release candidate commit. Deploy from the release worktree's `app` directory. Confirm `/api/pelecard-physical` returns a disabled/configuration response while flags are off, and digital hosted checkout and continuous Payper remain operational.
5. After separate approval for the controlled test, enable only the physical reservation/browser gates, run a no-charge reservation/cancel rehearsal, and then consider financial dispatch for one specified amount. The local Node worker can run without Docker using the encrypted local vault described in `physical-local-worker-setup.md`.

The physical accounting RPC records an already issued Payper document only after verified sale, accountant approval evidence, exact amount matching, and a check for existing accounting documents. It never calls invoice issuance. The physical ledger's unique payment, sale, and document identities prevent a second matching record. Automatic Payper issuance for physical card-present payments remains disabled pending provider mapping and eligibility confirmation.
