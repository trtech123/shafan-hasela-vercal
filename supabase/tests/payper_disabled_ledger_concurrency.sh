#!/usr/bin/env bash
set -euo pipefail
database=${1:?disposable rehearsal database required}
payment='77777777-7777-4777-8777-777777777777'
# Model an in-flight worker that obtained its processing lease just before the
# cutoff became active. The database is disposable; the trigger is restored.
psql -X -v ON_ERROR_STOP=1 -d "$database" -c "ALTER TABLE public.accounting_events DISABLE TRIGGER trg_hold_rivhit_pelecard_issuance; UPDATE public.accounting_events SET status='processing',attempt_count=0,lease_expires_at=now()-interval '1 minute' WHERE source_id='$payment'; ALTER TABLE public.accounting_events ENABLE TRIGGER trg_hold_rivhit_pelecard_issuance" >/dev/null
claim="UPDATE public.accounting_events SET status='processing',attempt_count=attempt_count+1,lease_token=gen_random_uuid(),lease_expires_at=now()+interval '5 minutes' WHERE source_id='$payment'"
temp_dir=$(mktemp -d)
trap 'rm -rf "$temp_dir"' EXIT
psql -X -v ON_ERROR_STOP=1 -d "$database" -c "$claim" >"$temp_dir/a" 2>&1 &
a=$!
psql -X -v ON_ERROR_STOP=1 -d "$database" -c "$claim" >"$temp_dir/b" 2>&1 &
b=$!
if wait "$a"; then echo 'first expired lease claim unexpectedly succeeded'; exit 1; fi
if wait "$b"; then echo 'second expired lease claim unexpectedly succeeded'; exit 1; fi
grep -q payper_transition_hold "$temp_dir/a"
grep -q payper_transition_hold "$temp_dir/b"
state=$(psql -X -At -d "$database" -c "SELECT status || ':' || attempt_count FROM public.accounting_events WHERE source_id='$payment'")
test "$state" = 'processing:0'
echo 'parallel_expired_lease_claims_rejected'
document_claim="UPDATE public.accounting_documents SET status='processing' WHERE provider='rivhit' AND source_type='order' AND source_id='44444444-4444-4444-8444-444444444444'"
psql -X -v ON_ERROR_STOP=1 -d "$database" -c "$document_claim" >"$temp_dir/c" 2>&1 &
c=$!
psql -X -v ON_ERROR_STOP=1 -d "$database" -c "$document_claim" >"$temp_dir/d" 2>&1 &
d=$!
if wait "$c"; then echo 'first stale document claim unexpectedly succeeded'; exit 1; fi
if wait "$d"; then echo 'second stale document claim unexpectedly succeeded'; exit 1; fi
grep -q payper_transition_hold "$temp_dir/c"
grep -q payper_transition_hold "$temp_dir/d"
echo 'parallel_stale_document_claims_rejected'
