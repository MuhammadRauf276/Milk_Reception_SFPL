@echo off
echo ==============================================
echo  Milk Reception App - 1-Click VM Update
echo ==============================================

cd /d C:\app

echo [1/4] Pulling latest code from GitHub...
git pull

echo [2/4] Applying Database Migrations...
node node_modules/prisma/build/index.js migrate deploy

echo [3/4] Building Next.js production app...
if exist .next\dev rmdir /s /q .next\dev
npm run build

echo [4/4] Restarting PM2 services...
pm2 restart all

echo ==============================================
echo  Update Complete! Everything is ONLINE.
echo ==============================================
pause
