Write-Host "========================================================" -ForegroundColor Cyan
Write-Host " Milk Reception App - Automated VM Update (Branch 4.4)" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan

# Determine working directory
if (Test-Path "$PSScriptRoot\.git") {
    Set-Location $PSScriptRoot
} else {
    Set-Location "C:\app"
}
Write-Host "Target directory: $(Get-Location)" -ForegroundColor Gray

Write-Host "`n[1/6] Force-syncing latest code from GitHub branch 4.4..." -ForegroundColor Yellow
git fetch origin 4.4
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] git fetch failed! Check internet connection or git remote access." -ForegroundColor Red
    pause
    exit $LASTEXITCODE
}
git checkout -B 4.4 origin/4.4
git reset --hard origin/4.4
git branch -f main 4.4
git clean -fd -e .env -e .env.production -e .env.local

Write-Host "`n[2/6] Verifying and installing dependencies..." -ForegroundColor Yellow
npm install --no-audit --no-fund

Write-Host "`n[3/6] Syncing Database Schema (Tables, Columns, Indexes, Views)..." -ForegroundColor Yellow
# Updates PostgreSQL schema safely WITHOUT adding any dummy data
node scripts/fix_vm_db.js
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n[ERROR] Database schema sync failed! Check database credentials in .env." -ForegroundColor Red
    pause
    exit $LASTEXITCODE
}
node node_modules/prisma/build/index.js migrate deploy

Write-Host "`n[4/6] Regenerating Prisma Client with latest schema..." -ForegroundColor Yellow
node node_modules/prisma/build/index.js generate
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n[ERROR] Prisma Client generate failed!" -ForegroundColor Red
    pause
    exit $LASTEXITCODE
}

Write-Host "`n[5/6] Clean-building Next.js production app..." -ForegroundColor Yellow
if (Test-Path ".next") {
    Remove-Item -Recurse -Force ".next"
}
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n[ERROR] Build failed! Please review the error above." -ForegroundColor Red
    pause
    exit $LASTEXITCODE
}

Write-Host "`n[6/6] Restarting PM2 production services..." -ForegroundColor Yellow
pm2 restart all --update-env
if ($LASTEXITCODE -ne 0) {
    pm2 start ecosystem.config.js
}
pm2 save

Write-Host "`n========================================================" -ForegroundColor Green
Write-Host " Update Complete! Everything is ONLINE on branch 4.4." -ForegroundColor Green
Write-Host " Database schema updated with NO dummy data." -ForegroundColor Green
Write-Host " Please do a Hard Refresh (Ctrl + Shift + R)" -ForegroundColor Green
Write-Host " in your browser to view the latest changes." -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green
pause
