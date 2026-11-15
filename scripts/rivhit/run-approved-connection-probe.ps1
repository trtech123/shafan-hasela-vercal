param([string]$ProjectRef = 'divzxsynczeifkpnpupl', [string]$FromDate = '2026-11-01')
$ErrorActionPreference = 'Continue'
$probeUrl = "https://$ProjectRef.supabase.co/functions/v1/rivhit-connection-check"
$resultsPath = Join-Path (Get-Location) '.tmp/rivhit-probe-results.json'
$probeKey = $null
$probeStatus = 'not_started'

function Invoke-ReadProbe([hashtable]$Body) {
  $headers = @{ Authorization = "Bearer $probeKey"; apikey = $probeKey }
  $payload = $Body | ConvertTo-Json -Compress
  return Invoke-RestMethod -Uri $probeUrl -Method Post -Headers $headers `
    -ContentType 'application/json' -Body $payload -TimeoutSec 25 -ErrorAction Stop
}

try {
  $raw = npx supabase projects api-keys --remote=$ProjectRef --profile supabase `
    --reveal --output-format json 2>$null
  if ($LASTEXITCODE -ne 0) { throw 'service_key_lookup_failed' }
  $keys = ($raw -join "`n") | ConvertFrom-Json
  $probeKey = [string](($keys.keys | Where-Object { $_.name -eq 'service_role' -and $_.type -eq 'legacy' } |
    Select-Object -First 1).api_key)
  if (-not $probeKey) { throw 'service_key_unavailable' }

  $probeStatus = 'identity_pending'
  $identity = Invoke-ReadProbe @{ mode = 'identity' }
  $name = [string]$identity.company.name
  $companyId = [int]$identity.company.company_id
  Write-Output "company_id=$companyId"
  Write-Output "accounting_type=$($identity.company.accounting_type)"
  $companyMatches = $name -match '\u05E9\u05E4\u05DF\s*\u05D4\u05E1\u05DC\u05E2|Shafan\s*Ha[sz]ela'
  Write-Output "company_name_matches_expected=$companyMatches"
  if (-not $companyMatches) {
    $probeStatus = 'company_identity_unconfirmed'
    throw 'company_identity_unconfirmed_stop'
  }

  $probeStatus = 'catalog_pending'
  $catalog = $null
  $dir = Split-Path -Parent $resultsPath
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  try {
    $catalog = Invoke-ReadProbe @{ mode = 'catalog'; expected_company_id = $companyId }
    Write-Output "sort_codes_total=$($catalog.sort_codes_total)"
    Write-Output "account_cards_total=$($catalog.account_cards_total)"
    Write-Output "account_cards_status=$($catalog.account_cards_status)"
    if ($catalog.account_cards_error_code -match '^[a-zA-Z0-9_-]{1,40}$') {
      Write-Output "account_cards_error_code=$($catalog.account_cards_error_code)"
    }
    @{ company = $identity.company; catalog = $catalog; journal_checks = @() } |
      ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $resultsPath -Encoding UTF8
  } catch {
    Write-Output "catalog_http_status=$($_.Exception.Response.StatusCode.value__)"
    try {
      $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
      $catalogError = $reader.ReadToEnd() | ConvertFrom-Json
      $reader.Dispose()
      if ($catalogError.stage -match '^(sort_codes|account_cards)$') {
        Write-Output "catalog_failed_stage=$($catalogError.stage)"
      }
      if ($catalogError.kind -match '^(response_shape|provider_or_transport)$') {
        Write-Output "catalog_failure_kind=$($catalogError.kind)"
      }
    } catch { }
  }

  $dates = @('2026-11-08') + @(1..15 | ForEach-Object { '2026-11-{0:D2}' -f $_ } |
    Where-Object { $_ -ne '2026-11-08' })
  $dates = @($dates | Where-Object { $_ -ge $FromDate })
  $journalChecks = @()
  $probeStatus = 'journal_pending'
  Start-Sleep -Seconds 10
  foreach ($date in $dates) {
    try {
      $check = Invoke-ReadProbe @{ mode = 'journal'; expected_company_id = $companyId; date = $date }
      $journalChecks += $check.document_200002
      Write-Output "journal_checked_date=$date matches=$(@($check.document_200002.matches).Count)"
    } catch {
      $status = $_.Exception.Response.StatusCode.value__
      $journalChecks += @{ searched_date = $date; status = 'unavailable'; http_status = $status }
      Write-Output "journal_checked_date=$date status=unavailable http_status=$status"
    }
    @{ company = $identity.company; catalog = $catalog; journal_checks = $journalChecks } |
      ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $resultsPath -Encoding UTF8
    if ($check -and @($check.document_200002.matches).Count -gt 0) { break }
    $check = $null
    Start-Sleep -Seconds 7
  }
  @{ company = $identity.company; catalog = $catalog; journal_checks = $journalChecks } |
    ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $resultsPath -Encoding UTF8
  $probeStatus = 'read_complete'
  Write-Output "probe_status=$probeStatus"
} catch {
  Write-Output "probe_status=$probeStatus"
  $httpStatus = $_.Exception.Response.StatusCode.value__
  if ($httpStatus) { Write-Output "probe_http_status=$httpStatus" }
  $safeBody = [string]$_.ErrorDetails.Message
  try {
    $responseStream = $_.Exception.Response.GetResponseStream()
    if ($responseStream) {
      $reader = New-Object System.IO.StreamReader($responseStream)
      $safeBody = $reader.ReadToEnd()
      $reader.Dispose()
    }
  } catch { $safeBody = '' }
  try {
    $errorBody = $safeBody | ConvertFrom-Json
    $safeCode = [string]$(if ($errorBody.code) { $errorBody.code } else { $errorBody.error })
    if ($safeCode -match '^[a-zA-Z0-9_-]{1,40}$') { Write-Output "probe_response_code=$safeCode" }
    if ([string]$errorBody.stage -match '^(company|sort_codes|account_cards|journal_report)$') {
      Write-Output "probe_failed_stage=$($errorBody.stage)"
    }
    if ([string]$errorBody.kind -match '^(response_shape|provider_or_transport)$') {
      Write-Output "probe_failure_kind=$($errorBody.kind)"
    }
    if ([string]$errorBody.provider_code -match '^[a-zA-Z0-9_-]{1,40}$') {
      Write-Output "probe_provider_code=$($errorBody.provider_code)"
    }
  } catch { }
  if ($safeBody -match 'Invalid JWT|invalid JWT|invalid_jwt') {
    Write-Output 'probe_auth_stage=gateway_jwt'
  } elseif ($safeBody -match 'unauthorized') {
    Write-Output 'probe_auth_stage=function_authorization'
  } elseif ($safeBody -match 'provider_read_failed') {
    Write-Output 'probe_auth_stage=provider_read'
  }
  Write-Output 'probe_error=redacted'
} finally {
  $probeKey = $null
  $removeOutput = npx supabase functions delete rivhit-connection-check --remote=$ProjectRef `
    --profile supabase --yes --output-format json 2>&1
  Write-Output "function_delete_exit=$LASTEXITCODE"
  $listed = npx supabase functions list --remote=$ProjectRef --profile supabase --output-format json 2>$null
  if ($LASTEXITCODE -eq 0) {
    $inventory = ($listed -join "`n") | ConvertFrom-Json
    $remaining = @($inventory.functions | Where-Object { $_.name -eq 'rivhit-connection-check' }).Count
    Write-Output "function_remaining=$remaining"
  } else {
    Write-Output 'function_remaining=unverified'
  }
}
