# EchoLink 生产发布脚本
# 用法: .\publish.ps1

$ErrorActionPreference = "Stop"

Write-Host "=== EchoLink 生产发布 ===" -ForegroundColor Cyan

# 清理旧的发布产物
$publishDir = "VoiceChat\bin\Release\net8.0-windows\win-x64\publish"
if (Test-Path $publishDir) {
    Remove-Item $publishDir -Recurse -Force
    Write-Host "已清理旧发布目录" -ForegroundColor Yellow
}

# 发布
Write-Host "正在发布 (自包含单文件, win-x64)..." -ForegroundColor Cyan
dotnet publish VoiceChat -c Release --self-contained true

if ($LASTEXITCODE -ne 0) {
    Write-Host "发布失败!" -ForegroundColor Red
    exit 1
}

# 统计
$exe = Get-Item "$publishDir\EchoLink.exe" -ErrorAction SilentlyContinue
if ($exe) {
    $sizeMB = [math]::Round($exe.Length / 1MB, 1)
    Write-Host "`n=== 发布成功 ===" -ForegroundColor Green
    Write-Host "输出: $publishDir\EchoLink.exe" -ForegroundColor White
    Write-Host "大小: $sizeMB MB" -ForegroundColor White

    # 列出发布目录内容
    Write-Host "`n发布文件:" -ForegroundColor Cyan
    Get-ChildItem $publishDir | ForEach-Object {
        $s = if ($_.PSIsContainer) { "<DIR>" } else { "$([math]::Round($_.Length / 1KB, 1)) KB" }
        Write-Host "  $($_.Name)  $s"
    }
} else {
    Write-Host "未找到输出文件!" -ForegroundColor Red
    exit 1
}
