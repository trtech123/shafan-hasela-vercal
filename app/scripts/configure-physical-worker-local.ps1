param([Parameter(Mandatory = $true)][string]$CertificatePath)

$ErrorActionPreference = 'Stop'
if (-not [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform(
    [System.Runtime.InteropServices.OSPlatform]::Windows)) { throw 'windows_dpapi_required' }
$certificate = Get-Content -LiteralPath $CertificatePath -Raw
if ($certificate -notmatch '-----BEGIN CERTIFICATE-----') { throw 'physical_database_ca_invalid' }

$vaultDirectory = Join-Path $env:LOCALAPPDATA 'ShafanHasela'
New-Item -ItemType Directory -Path $vaultDirectory -Force | Out-Null
$vaultPath = Join-Path $vaultDirectory 'physical-worker-secrets.xml'
$values = [pscustomobject]@{
  User = Read-Host 'Pelecard physical J4 username' -AsSecureString
  Password = Read-Host 'Pelecard physical J4 password' -AsSecureString
  DatabaseUrl = Read-Host 'Supabase session-pooler database URL' -AsSecureString
  CertificatePath = (Resolve-Path -LiteralPath $CertificatePath).Path
}
$values | Export-Clixml -LiteralPath $vaultPath
Write-Output 'Physical worker credentials saved for this Windows user. Financial dispatch remains off.'
