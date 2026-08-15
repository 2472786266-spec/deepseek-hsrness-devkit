# DSH DevKit one-click launcher (ASCII-only for PS 5.1 encoding safety)
$ErrorActionPreference = 'SilentlyContinue'
$url = 'http://127.0.0.1:3080/'

Write-Host '=== DSH DevKit Launcher ==='

# 1. check if DSH is already running
$running = $false
try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
    if ($r.StatusCode -ge 200) { $running = $true }
} catch {}

# 2. start DSH if not running
if ($running) {
    Write-Host 'DSH is already running. Opening browser...'
} else {
    Write-Host 'Starting DSH Web (first boot may take several seconds)...'
    Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'dsh web'
    for ($i = 0; $i -lt 45; $i++) {
        Start-Sleep -Seconds 1
        try {
            $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 1
            if ($r.StatusCode -ge 200) { $running = $true; break }
        } catch {}
    }
}

# 3. open browser
if ($running) {
    Start-Process $url
    Write-Host "Opened: $url"
} else {
    Write-Host 'DSH did not become ready. Run "dsh web" manually in PowerShell.'
}

Write-Host ''
Write-Host 'DevKit (dynamic plugin) needs restoring after a process restart:'
Write-Host '  send "restore devkit" in a session and the agent will restore it.'
Write-Host ''
Start-Sleep -Seconds 5
