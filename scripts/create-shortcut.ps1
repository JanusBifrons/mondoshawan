# Creates "Mondo" shortcuts that open the app with no terminal window.
#   npm run shortcut                 Desktop + Start menu
#   npm run shortcut -- -Startup     also start Mondo when you sign in to Windows
#   npm run shortcut -- -Remove      remove all of them
param([switch]$Startup, [switch]$Remove)

$root = Split-Path -Parent $PSScriptRoot
$electron = Join-Path $root "node_modules\electron\dist\electron.exe"
$icon = Join-Path $root "assets\mondo.ico"
$places = @(
  [Environment]::GetFolderPath("Desktop"),
  (Join-Path ([Environment]::GetFolderPath("StartMenu")) "Programs")
)
if ($Startup -or $Remove) { $places += [Environment]::GetFolderPath("Startup") }

if ($Remove) {
  foreach ($dir in $places) {
    $lnk = Join-Path $dir "Mondo.lnk"
    if (Test-Path $lnk) { Remove-Item $lnk; Write-Output "Removed $lnk" }
  }
  exit 0
}

if (-not (Test-Path $electron)) {
  Write-Error "Electron isn't installed yet. Run 'npm install' in $root first."
  exit 1
}

$shell = New-Object -ComObject WScript.Shell
foreach ($dir in $places) {
  $lnk = Join-Path $dir "Mondo.lnk"
  $s = $shell.CreateShortcut($lnk)
  $s.TargetPath = $electron
  $s.Arguments = "`"$root`""
  $s.WorkingDirectory = $root
  $s.IconLocation = "$icon,0"
  $s.Description = "Mondo: Claude Code session monitor"
  $s.Save()
  Write-Output "Created $lnk"
}
