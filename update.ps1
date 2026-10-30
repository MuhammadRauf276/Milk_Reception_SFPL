Write-Host "==============================================" -ForegroundColor Cyan
Write-Host " Milk Reception App - Automated VM Update" -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan

Set-Location "C:\app"

Write-Host "`n[1/4] Pulling latest code from GitHub..." -ForegroundColor Yellow
git pull origin main

Write-Host "`n[2/4] Syncing Database Schema and Migrations..." -ForegroundColor Yellow
node scripts/fix_vm_db.js
node node_modules/prisma/build/index.js migrate deploy

Write-Host "`n[3/4] Building Next.js production app..." -ForegroundColor Yellow
if (Test-Path ".next\dev") {
    Remove-Item -Recurse -Force ".next\dev"
}
npm run build

Write-Host "`n[4/4] Restarting PM2 production services..." -ForegroundColor Yellow
pm2 restart ecosystem.config.js
if ($LASTEXITCODE -ne 0) {
    pm2 start ecosystem.config.js
}
pm2 save

Write-Host "`n==============================================" -ForegroundColor Green
Write-Host " Update Complete! Everything is ONLINE." -ForegroundColor Green
Write-Host "==============================================" -ForegroundColor Green
