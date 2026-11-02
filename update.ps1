Write-Host "==============================================" -ForegroundColor Cyan
Write-Host " Milk Reception App - Automated VM Update" -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan

Set-Location "C:\app"

Write-Host "`n[1/4] Force-syncing latest code from GitHub main..." -ForegroundColor Yellow
git checkout -f main
git fetch origin main
git reset --hard origin/main
git clean -fd -e .env -e .env.production -e .env.local

Write-Host "`n[2/4] Syncing Database Schema and Migrations..." -ForegroundColor Yellow
node scripts/fix_vm_db.js
node node_modules/prisma/build/index.js migrate deploy

Write-Host "`n[3/4] Clean-building Next.js production app..." -ForegroundColor Yellow
if (Test-Path ".next") {
    Remove-Item -Recurse -Force ".next"
}
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n[ERROR] Build failed! Please review the error above." -ForegroundColor Red
    pause
    exit $LASTEXITCODE
}

Write-Host "`n[4/4] Restarting PM2 production services..." -ForegroundColor Yellow
pm2 restart all --update-env
if ($LASTEXITCODE -ne 0) {
    pm2 start ecosystem.config.js
}
pm2 save

Write-Host "`n==============================================" -ForegroundColor Green
Write-Host " Update Complete! Everything is ONLINE." -ForegroundColor Green
Write-Host " Please do a Hard Refresh (Ctrl + Shift + R)" -ForegroundColor Green
Write-Host " in your browser to view the latest changes." -ForegroundColor Green
Write-Host "==============================================" -ForegroundColor Green
