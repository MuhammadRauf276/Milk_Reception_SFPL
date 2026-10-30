@echo off
echo ==============================================
echo  Milk Reception App - 1-Click VM Update
echo ==============================================

cd /d C:\app

echo [1/4] Pulling latest code from GitHub...
git pull origin main

echo [2/4] Syncing Database Schema and Migrations...
node scripts/fix_vm_db.js
node node_modules/prisma/build/index.js migrate deploy

echo [3/4] Building Next.js production app...
if exist .next\dev rmdir /s /q .next\dev
npm run build

echo [4/4] Restarting PM2 production services...
pm2 restart ecosystem.config.js || pm2 start ecosystem.config.js
pm2 save

echo ==============================================
echo  Update Complete! Everything is ONLINE.
echo ==============================================
pause
