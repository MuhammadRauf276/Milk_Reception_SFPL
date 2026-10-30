@echo off
echo ==============================================
echo  Starting Milk Reception App Services...
echo ==============================================

cd /d C:\app

pm2 resurrect 2>nul || pm2 start ecosystem.config.js

pm2 status

echo ==============================================
echo  All Services are ONLINE!
echo  Open http://localhost:3000 in your browser.
echo ==============================================
pause
