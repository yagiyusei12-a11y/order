#Requires -Version 5.1
<#
  Deploy order-app to the standby Kagoya VPS (133.18.180.76 by default).
  Does not touch daiko / sougei PHP. Does not deploy to production ORDER_VPS_HOST.

  .env.deploy:
    ORDER_VPS_STANDBY_HOST=133.18.180.76
    ORDER_VPS_USER / ORDER_VPS_KEY  (same as production unless overridden)
    ORDER_VPS_STANDBY_KEY           (optional, defaults to ORDER_VPS_KEY)
    ORDER_VPS_STANDBY_PATH          (default ~/order)
#>
param(
  [switch]$AllowDirty,
  [switch]$SkipPush
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$envFile = Join-Path $root ".env.deploy"
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
    if ($_ -match '^\s*([^#=]+)=(.*)$') {
      $k = $matches[1].Trim()
      $v = $matches[2].Trim().Trim('"')
      [Environment]::SetEnvironmentVariable($k, $v, "Process")
    }
  }
}

$hostName = if ($env:ORDER_VPS_STANDBY_HOST) { $env:ORDER_VPS_STANDBY_HOST } else { "133.18.180.76" }
$user = if ($env:ORDER_VPS_USER) { $env:ORDER_VPS_USER } else { "ubuntu" }
$key = if ($env:ORDER_VPS_STANDBY_KEY) { $env:ORDER_VPS_STANDBY_KEY } else { $env:ORDER_VPS_KEY }
$remotePath = if ($env:ORDER_VPS_STANDBY_PATH) { $env:ORDER_VPS_STANDBY_PATH } else { "~/order" }

if (-not $key) {
  Write-Host "Missing ORDER_VPS_KEY (or ORDER_VPS_STANDBY_KEY). Copy .env.deploy.example to .env.deploy." -ForegroundColor Red
  exit 1
}
if (-not (Test-Path $key)) {
  Write-Host "SSH key not found: $key" -ForegroundColor Red
  exit 1
}

$dirty = git status --porcelain 2>$null
if ($dirty -and -not $AllowDirty) {
  Write-Host "Working tree has uncommitted changes. Commit first, or pass -AllowDirty." -ForegroundColor Red
  git status -s
  exit 1
}

if (-not $SkipPush) {
  Write-Host "git push origin main ..." -ForegroundColor Cyan
  git push origin main
  if ($LASTEXITCODE -ne 0) {
    Write-Host "push failed; continuing with local git archive (standby does not need GitHub)." -ForegroundColor Yellow
  }
}

Write-Host "SSH probe $user@$hostName ..." -ForegroundColor Cyan
& ssh -i $key -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=12 "$user@$hostName" "echo SSH_OK"
if ($LASTEXITCODE -ne 0) {
  Write-Host "Cannot SSH to $hostName yet (still initializing?). Retry later." -ForegroundColor Red
  exit 1
}

Write-Host "Copy tree via git archive ..." -ForegroundColor Cyan
$tarCmd = "mkdir -p $remotePath && tar -xf - -C $remotePath"
git archive --format=tar HEAD | & ssh -i $key -o BatchMode=yes -o StrictHostKeyChecking=accept-new "$user@$hostName" $tarCmd
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$remote = "set -e; if ! command -v node >/dev/null 2>&1 || ! command -v docker >/dev/null 2>&1; then sudo bash $remotePath/deploy/vps/provision-standby.sh; fi; cd $remotePath; bash deploy/vps/bootstrap-standby.sh"
$remoteUnix = ($remote -replace "`r", "").Trim() + "`n"
Write-Host "SSH $user@${hostName}: provision if needed, bootstrap-standby ..." -ForegroundColor Cyan
$remoteUnix | & ssh -i $key -o BatchMode=yes -o StrictHostKeyChecking=accept-new "$user@$hostName" "bash -s"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Standby deploy finished: http://$hostName/health" -ForegroundColor Green
Write-Host "First staff: http://$hostName/staff-app/setup" -ForegroundColor Green
