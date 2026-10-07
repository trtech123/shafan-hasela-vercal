# Deployed Edge Function source evidence

These snapshots were downloaded read-only from Supabase project `divzxsynczeifkpnpupl` on 2026-10-07. No function was invoked or deployed. `manifest.json` maps each of the 26 deployed functions and its version to its exact source/dependency files. Blob filenames and manifest hashes are SHA256 of the downloaded bytes. No environment values, user data or credentials were downloaded.

Eight shared paths have different versions in different live bundles. Choosing one shared version would change some live functions. The reconciled `supabase/functions` entrypoints therefore use private `_deployed_shared` and, where required, `_deployed_functions` directories. Every runtime file preserves the captured source apart from relative import specifiers. `supabase/config.toml` preserves the live per-function JWT settings. This is source reconciliation only, not authorization to redeploy.

Run `node scripts/production/reconcile-edge-sources.mjs` to verify all 26 runtime dependency graphs against the snapshots. `--write` reconstructs local files only; it has no deployment or provider access. The verifier checks all relative runtime imports against their originating live bundle, rejects location-dependent source operations, and detects any changed function body.

ESZIP omits erased type-only dependencies. Those imports refer to the existing repository declarations. Three absent type-only modules (`pelecard-order-payment.ts`, `rivhit/immediate-dispatch.ts`, `rivhit/immediate-customer.ts`) contain only interfaces recovered from existing local integration source; no undeployed runtime implementations were copied. Original shared files retained for tests/historical source are not used in place of a function's captured private runtime dependencies.

Conflicting paths under `supabase/functions/_shared`:

- `payment-store.ts`
- `payment-types.ts`
- `payment-accounting/payment-mapper.ts`
- `payment-edge-runtime.ts`
- `rivhit/client.ts` (three deployed versions)
- `rivhit/supabase-repository.ts`
- `rivhit/workflow.ts`
- `pelecard-live-callback.ts`

Vercel automatic Git deployments must be disabled and verified before a future main push; no Vercel setting was changed during this reconciliation.
