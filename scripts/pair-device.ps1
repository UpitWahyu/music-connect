# Generate a pairing code for a new Music Connect player device (Windows).
#
# Usage:
#   $env:MUSIC_PASSWORD = "xxx"
#   .\scripts\pair-device.ps1 desktop
#
# Optional: -Server, -Username
param(
    [Parameter(Mandatory = $true)][string]$DeviceId,
    [string]$Server = "https://music.example.com",
    [string]$Username = "admin"
)

if (-not $env:MUSIC_PASSWORD) {
    Write-Host "Set MUSIC_PASSWORD dulu:" -ForegroundColor Yellow
    Write-Host '  $env:MUSIC_PASSWORD = "xxx"'
    Write-Host "lalu jalankan ulang script."
    exit 1
}

Write-Host "→ Login ke $Server ..."
$body = @{ username = $Username; password = $env:MUSIC_PASSWORD } | ConvertTo-Json
$login = Invoke-RestMethod -Uri "$Server/api/auth/login" -Method Post -ContentType "application/json" -Body $body

Write-Host "→ Generate pairing code untuk '$DeviceId' ..."
$result = Invoke-RestMethod -Uri "$Server/api/devices/$DeviceId/pair" -Method Post `
    -Headers @{ Authorization = "Bearer $($login.token)" } `
    -ContentType "application/json" -Body "{}"

Write-Host ""
Write-Host "════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Pairing code:  $($result.pairingCode)" -ForegroundColor Green
Write-Host "  Berlaku 5 menit, sekali pakai."
Write-Host "════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "Jalankan di mesin player:"
Write-Host '  $env:MUSIC_SERVER_URL = "wss://music.example.com/ws/player"'
Write-Host "  `$env:PAIRING_CODE = `"$($result.pairingCode)`""
Write-Host "  pnpm start"
