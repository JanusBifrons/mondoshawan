# Restarts the Mondo desktop app without killing the work it started.
#   npm run restart              wait for running jobs and talk replies to finish, then restart
#   npm run restart -- -NoWait   restart now (running jobs keep going; Mondo picks them up again)
#
# Background jobs, talk replies and agent windows are separate processes. Stopping Mondo's
# process tree with taskkill /T kills them too (it once cut off a design talk mid-reply), so
# this stops only Mondo's own processes, one by one. It rebuilds itself on start if the code changed.
param([switch]$NoWait, [int]$WaitMinutes = 10)

$repo = Split-Path -Parent $PSScriptRoot
$base = "http://127.0.0.1:4317"

function Running-Jobs {
  try {
    $r = Invoke-RestMethod -Uri "$base/api/jobs" -TimeoutSec 5
    return @($r.jobs | Where-Object { $_.status -eq "running" })
  } catch {
    return @() # Mondo isn't answering: nothing to wait for
  }
}

if (-not $NoWait) {
  $deadline = (Get-Date).AddMinutes($WaitMinutes)
  while ($true) {
    $running = Running-Jobs
    if ($running.Count -eq 0) { break }
    if ((Get-Date) -gt $deadline) {
      Write-Host "Still running after $WaitMinutes min: $($running.title -join ', '). Restarting anyway; they keep going."
      break
    }
    Write-Host "Waiting for: $($running.title -join ', ')"
    Start-Sleep -Seconds 5
  }
}

# Mondo's own processes: the Electron window and its helpers, serve.mjs and the Next server,
# which all run from this repo's electron.exe. Stopped individually (no /T), so their children survive.
$own = Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -like "*$repo*" }
foreach ($p in $own) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
Write-Host "Stopped $(@($own).Count) Mondo process(es)."

$t = 0
while ($t -lt 30 -and (Get-NetTCPConnection -LocalPort 4317 -State Listen -ErrorAction SilentlyContinue)) { Start-Sleep 1; $t++ }

Start-Process -FilePath "$repo\node_modules\electron\dist\electron.exe" -ArgumentList "`"$repo`"" -WorkingDirectory $repo
$t = 0
while ($t -lt 480) {
  Start-Sleep 5; $t += 5
  if ((Get-NetTCPConnection -LocalPort 4317 -State Listen -ErrorAction SilentlyContinue) -and
      (Get-NetTCPConnection -LocalPort 4318 -State Listen -ErrorAction SilentlyContinue)) { break }
}
$stamp = (Get-Content "$repo\.next\mondo-build-stamp" -ErrorAction SilentlyContinue | Select-Object -First 1)
Write-Host "Mondo is up after $t s (build $($stamp.Substring(0, [Math]::Min(7, "$stamp".Length))))."
