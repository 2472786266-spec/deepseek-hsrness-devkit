# DSH 开发增强套件 · 一键启动脚本
# 双击桌面快捷方式（或本文件）即可：启动 DSH Web + 打开浏览器。
# 用法：powershell -ExecutionPolicy Bypass -File "start-devkit.ps1"

$ErrorActionPreference = 'SilentlyContinue'
$url = 'http://127.0.0.1:3080/'

Write-Host '=== DSH 开发增强套件 ==='

# 1. 检测 DSH 是否已在运行
$running = $false
try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
    if ($r.StatusCode -ge 200) { $running = $true }
} catch {}

if ($running) {
    Write-Host 'DSH 已在运行，直接打开浏览器...'
} else {
    Write-Host '正在启动 DSH Web（首次启动约需数秒）...'
    # 通过 cmd 调用全局 dsh shim（避免 PATH 解析问题），后台隐藏窗口
    Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'dsh web' -WindowStyle Hidden
    # 轮询等待就绪
    for ($i = 0; $i -lt 45; $i++) {
        Start-Sleep -Seconds 1
        try {
            $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 1
            if ($r.StatusCode -ge 200) { $running = $true; break }
        } catch {}
    }
}

# 2. 打开浏览器
if ($running) {
    Start-Process $url
    Write-Host "已打开：$url"
} else {
    Write-Host 'DSH 未能自动就绪，请手动在 PowerShell 执行：dsh web'
}

Write-Host ''
Write-Host 'DSH 已就绪。开发增强套件（动态插件）重启后需恢复：'
Write-Host '  在会话里发一句「恢复开发套件」即可自动恢复（源码已在磁盘）。'
Start-Sleep -Seconds 3
