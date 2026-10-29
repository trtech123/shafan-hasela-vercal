#!/usr/bin/env bash
set -euo pipefail
database=${1:?disposable activation rehearsal database required}
one='c0000000-0000-4000-8000-000000000001'
two='c0000000-0000-4000-8000-000000000002'
# Reset only the disposable fixture after its one-document assertion.
psql -X -v ON_ERROR_STOP=1 -d "$database" -c "UPDATE public.payper_document_ledger SET state='source_frozen',dispatch_reserved_at=NULL WHERE payment_id='$one'; UPDATE public.payper_dispatch_control SET dispatch_remaining=1" >/dev/null
temp_dir=$(mktemp -d)
trap 'rm -rf "$temp_dir"' EXIT
claim() {
 psql -X -v ON_ERROR_STOP=1 -d "$database" -c "SELECT set_config('request.jwt.claim.role','service_role',false); SELECT public.reserve_payper_dispatch('$1');" >"$2" 2>&1
}
claim "$one" "$temp_dir/one" & a=$!
claim "$two" "$temp_dir/two" & b=$!
success=0
if wait "$a"; then success=$((success+1)); fi
if wait "$b"; then success=$((success+1)); fi
test "$success" -eq 1
test "$(psql -X -At -d "$database" -c 'SELECT dispatch_remaining FROM public.payper_dispatch_control')" = 0
test "$(psql -X -At -d "$database" -c "SELECT count(*) FROM public.payper_document_ledger WHERE state='dispatch_reserved'")" = 1
psql -X -v ON_ERROR_STOP=1 -d "$database" -c "SELECT set_config('request.jwt.claim.role','service_role',false); SELECT public.hold_payper_source(payment_id) FROM public.payper_document_ledger WHERE state='source_frozen';" >/dev/null
test "$(psql -X -At -d "$database" -c "SELECT count(*) FROM public.payper_document_ledger WHERE state='source_blocked' AND reconciliation_code='pre_dispatch_review_required'")" = 1
echo 'parallel_single_document_reservation_passed'
