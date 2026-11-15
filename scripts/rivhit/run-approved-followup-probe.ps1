param([string]$ProjectRef = 'divzxsynczeifkpnpupl',
  [string]$CustomerTypesCsv = '40,42,44', [switch]$SkipDailyJournal,
  [switch]$ReadAccountJournals)
$ErrorActionPreference = 'Continue'
$probeUrl = "https://$ProjectRef.supabase.co/functions/v1/rivhit-connection-check"
$resultsPath = Join-Path (Get-Location) '.tmp/rivhit-followup-results.json'
$probeKey = $null
$stage = 'parameters'
$state = @{ company_verified = $false; journal_2026_11_09 = $null;
  account_types = @(); account_journals = @() }

function Invoke-ReadProbe([hashtable]$Body) {
  $headers = @{ Authorization = "Bearer $probeKey"; apikey = $probeKey }
  return Invoke-RestMethod -Uri $probeUrl -Method Post -Headers $headers `
    -ContentType 'application/json' -Body ($Body | ConvertTo-Json -Compress) `
    -TimeoutSec 25 -ErrorAction Stop
}

function Write-SanitizedResult {
  $state | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $resultsPath -Encoding UTF8
}

try {
  $CustomerTypes = @($CustomerTypesCsv.Split(',') | ForEach-Object { [int]$_.Trim() })
  if (@($CustomerTypes | Where-Object { $_ -lt 40 -or $_ -gt 59 }).Count -gt 0)
    { throw 'invalid_customer_type' }
  $stage = 'service_key_lookup'
  $raw = npx supabase projects api-keys --remote=$ProjectRef --profile supabase `
    --reveal --output-format json 2>$null
  if ($LASTEXITCODE -ne 0) { throw 'service_key_lookup_failed' }
  $keys = ($raw -join "`n") | ConvertFrom-Json
  $probeKey = [string](($keys.keys | Where-Object { $_.name -eq 'service_role' -and $_.type -eq 'legacy' } |
    Select-Object -First 1).api_key)
  if (-not $probeKey) { throw 'service_key_unavailable' }
  $stage = 'company_identity'
  $identity = Invoke-ReadProbe @{ mode = 'identity' }
  $companyId = [int]$identity.company.company_id
  $nameMatches = [string]$identity.company.name -match '\u05E9\u05E4\u05DF\s*\u05D4\u05E1\u05DC\u05E2'
  if (-not $nameMatches -or $companyId -ne 512783333) {
    Write-Output 'company_verification=failed; stopping before accounting reads'
    throw 'company_identity_unconfirmed_stop'
  }
  $state.company_verified = $true
  Write-Output 'company_verification=passed'
  Write-SanitizedResult

  if (-not $SkipDailyJournal) { for ($attempt = 1; $attempt -le 3; $attempt++) {
    try {
      $journal = Invoke-ReadProbe @{ mode = 'journal'; expected_company_id = $companyId;
        date = '2026-11-09' }
      $state.journal_2026_11_09 = $journal.document_200002
      Write-Output "journal_2026_11_09=read; rows=$($journal.document_200002.searched_rows); matches=$($journal.document_200002.match_count); amount_4_candidates=$($journal.document_200002.amount_4_candidates)"
      Write-SanitizedResult
      break
    } catch {
      $httpStatus = $_.Exception.Response.StatusCode.value__
      Write-Output "journal_2026_11_09_attempt=$attempt; http_status=$httpStatus"
      $state.journal_2026_11_09 = @{ status = 'unavailable'; attempts = $attempt;
        http_status = $httpStatus }
      Write-SanitizedResult
      if ($attempt -lt 3) { Start-Sleep -Seconds (5 * $attempt) }
    }
  } }

  foreach ($customerType in $CustomerTypes) {
    $stage = 'account_cards'
    try {
      $result = Invoke-ReadProbe @{ mode = 'account_cards'; expected_company_id = $companyId;
        customer_type = $customerType }
      $state.account_types += @{ customer_type = $customerType; status = 'read';
        cards_total = $result.account_cards_total;
        relevant_total = $result.relevant_cards_total;
        relevant_cards = @($result.account_cards) }
      Write-Output "account_type=$customerType; status=read; cards=$($result.account_cards_total); relevant=$($result.relevant_cards_total)"
      if ($ReadAccountJournals) {
        foreach ($card in @($result.account_cards)) {
          try {
            $accountJournal = Invoke-ReadProbe @{ mode = 'account_journal';
              expected_company_id = $companyId; customer_type = $customerType;
              customer_id = [int]$card.customer_id }
            $state.account_journals += $accountJournal.account_journal
            Write-Output "account_journal_type=$customerType; account_id=$($card.customer_id); status=read; rows=$($accountJournal.account_journal.searched_rows); matches=$($accountJournal.account_journal.match_count)"
          } catch {
            $state.account_journals += @{ customer_type = $customerType;
              customer_id = $card.customer_id; status = 'unavailable';
              http_status = $_.Exception.Response.StatusCode.value__ }
            Write-Output "account_journal_type=$customerType; account_id=$($card.customer_id); status=unavailable"
          }
          Write-SanitizedResult
          Start-Sleep -Seconds 1
        }
      }
    } catch {
      $httpStatus = $_.Exception.Response.StatusCode.value__
      $state.account_types += @{ customer_type = $customerType; status = 'unavailable';
        http_status = $httpStatus }
      Write-Output "account_type=$customerType; status=unavailable; http_status=$httpStatus"
    }
    Write-SanitizedResult
    Start-Sleep -Seconds 2
  }
  Write-Output 'probe_status=read_complete'
} catch {
  Write-Output "probe_status=failed_redacted; stage=$stage"
} finally {
  $probeKey = $null
  npx supabase functions delete rivhit-connection-check --remote=$ProjectRef `
    --profile supabase --yes --output-format json 2>$null | Out-Null
  Write-Output "function_delete_exit=$LASTEXITCODE"
  $listed = npx supabase functions list --remote=$ProjectRef --profile supabase --output-format json 2>$null
  if ($LASTEXITCODE -eq 0) {
    $inventory = ($listed -join "`n") | ConvertFrom-Json
    Write-Output "function_remaining=$(@($inventory.functions | Where-Object { $_.name -eq 'rivhit-connection-check' }).Count)"
  } else { Write-Output 'function_remaining=unverified' }
}
