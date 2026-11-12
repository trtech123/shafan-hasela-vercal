param(
  [ValidateSet('check', 'run')][string]$Mode = 'check',
  [Parameter(Mandatory = $true)][string]$CertificatePath,
  [string]$ServiceRoleEnvFile = (Join-Path $PSScriptRoot '..\..\..\..\app\.env.local')
)

$ErrorActionPreference = 'Stop'
$certificate = Get-Content -LiteralPath $CertificatePath -Raw
if ($certificate -notmatch '-----BEGIN CERTIFICATE-----') { throw 'physical_database_ca_invalid' }

function Read-Secret([string]$prompt) {
  $secure = Read-Host $prompt -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $secure.Dispose() }
}

$serviceRoleLine = Get-Content -LiteralPath $ServiceRoleEnvFile |
  Where-Object { $_ -match '^SUPABASE_SERVICE_ROLE_KEY=' } | Select-Object -First 1
if (-not $serviceRoleLine) { throw 'supabase_service_role_key_missing' }
$serviceRole = ($serviceRoleLine -split '=', 2)[1].Trim().Trim('"', "'")
if (-not $serviceRole) { throw 'supabase_service_role_key_missing' }

$env:PELECARD_PHYSICAL_TERMINAL = '2814926015'
$env:PELECARD_PHYSICAL_USER = Read-Secret 'Physical J4 username'
$env:PELECARD_PHYSICAL_PASSWORD = Read-Secret 'Physical J4 password'
$env:PELECARD_PHYSICAL_DATABASE_URL = Read-Secret 'Supabase session-pooler database URL'
$env:PELECARD_PHYSICAL_DATABASE_CA = $certificate
$env:SUPABASE_URL = 'https://divzxsynczeifkpnpupl.supabase.co'
$env:SUPABASE_SERVICE_ROLE_KEY = $serviceRole
$env:PELECARD_PHYSICAL_ENABLED = 'true'
$env:PELECARD_PHYSICAL_DISPATCH_ENABLED = 'false'
$env:PELECARD_PHYSICAL_WORKER_MAX_MS = '330000'

try {
  Push-Location (Join-Path $PSScriptRoot '..')
  if ($Mode -eq 'check') { & node scripts/physical-terminal-worker.mjs --check }
  else { & node scripts/physical-terminal-worker.mjs }
  if ($LASTEXITCODE -ne 0) { throw 'physical_worker_failed' }
}
finally {
  Pop-Location
  foreach ($name in @('PELECARD_PHYSICAL_USER', 'PELECARD_PHYSICAL_PASSWORD',
      'PELECARD_PHYSICAL_DATABASE_URL', 'PELECARD_PHYSICAL_DATABASE_CA',
      'SUPABASE_SERVICE_ROLE_KEY')) {
    [Environment]::SetEnvironmentVariable($name, $null, 'Process')
  }
}
