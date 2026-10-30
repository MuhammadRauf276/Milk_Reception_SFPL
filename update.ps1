Write-Host "==============================================" -ForegroundColor Cyan
Write-Host " Milk Reception App - Automated VM Update" -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan

Set-Location "C:\app"

Write-Host "`n[1/4] Pulling latest code from GitHub..." -ForegroundColor Yellow
git pull

Write-Host "`n[2/4] Applying Database Migrations..." -ForegroundColor Yellow
node node_modules/prisma/build/index.js migrate deploy

Write-Host "`n[3/4] Building Next.js production app..." -ForegroundColor Yellow
if (Test-Path ".next\dev") {
    Remove-Item -Recurse -Force ".next\dev"
}
npm run build

Write-Host "`n[4/4] Restarting PM2 services..." -ForegroundColor Yellow
pm2 restart all

Write-Host "`n==============================================" -ForegroundColor Green
Write-Host " Update Complete! Everything is ONLINE." -ForegroundColor Green
Write-Host "==============================================" -ForegroundColor Green
