@echo off
echo ==============================================
echo  Milk Reception App - 1-Click VM Update
echo ==============================================

cd /d C:\app

echo.
echo [1/4] Force-syncing latest code from GitHub main...
git checkout -f main
git fetch origin main
git reset --hard origin/main
git clean -fd -e .env -e .env.production -e .env.local

echo.
echo [2/4] Syncing Database Schema and Migrations...
node scripts/fix_vm_db.js
node node_modules/prisma/build/index.js migrate deploy

echo.
echo [3/4] Clean-building Next.js production app...
if exist .next rmdir /s /q .next
call npm run build
if %errorlevel% neq 0 (
  echo.
  echo [ERROR] Build failed! Please review the error above.
  pause
  exit /b %errorlevel%
)

echo.
echo [4/4] Restarting PM2 production services...
call pm2 restart all --update-env || call pm2 start ecosystem.config.js
call pm2 save

echo ==============================================
echo  Update Complete! Everything is ONLINE.
echo  Please do a Hard Refresh (Ctrl + Shift + R)
echo  in your browser to view the latest changes.
echo ==============================================
pause
