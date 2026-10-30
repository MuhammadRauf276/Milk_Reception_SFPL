@echo off
setlocal enabledelayedexpansion

echo ==============================================
echo  Milk Reception App - 1-Click Push to GitHub
echo ==============================================

cd /d "%~dp0"

echo [1/3] Staging changes...
git add .

set /p msg="Enter commit message (or press ENTER for default): "
if "!msg!"=="" set msg=update: production improvements and bugfixes

echo [2/3] Committing changes...
git commit -m "!msg!"

echo [3/3] Pushing to GitHub (main and feature/phase-3)...
git push origin feature/phase-3
git branch -f main feature/phase-3
git push origin main

echo ==============================================
echo  Pushed to GitHub Successfully!
echo.
echo  NEXT STEP ON VM:
echo  Open your Virtual Machine and double-click:
echo  C:\app\update.bat
echo ==============================================
pause
