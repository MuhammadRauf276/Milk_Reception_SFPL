@echo off
setlocal enabledelayedexpansion

echo ==============================================
echo  Milk Reception App - 1-Click Push to GitHub
echo ==============================================

cd /d "%~dp0"

echo.
echo [1/3] Staging changes...
git add -A

set /p msg="Enter commit message (or press ENTER for default): "
if "!msg!"=="" set msg=feat(production): center login form, remove station accounts, relax permissions policy, add camera fallback

echo.
echo [2/3] Committing changes...
git commit -m "!msg!"

echo.
echo [3/3] Pushing to GitHub...
for /f "tokens=*" %%i in ('git rev-parse --abbrev-ref HEAD') do set CURRENT_BRANCH=%%i
echo Current branch: !CURRENT_BRANCH!
git push origin !CURRENT_BRANCH!

echo Promoting !CURRENT_BRANCH! to main...
git branch -f main !CURRENT_BRANCH!
git push origin main --force

echo ==============================================
echo  Pushed to GitHub Successfully!
echo.
echo  NEXT STEP ON VIRTUAL MACHINE:
echo  1. Connect to VM desktop.
echo  2. Open PowerShell in C:\app and run:
echo     .\update.bat
echo     (or double-click C:\app\update.bat in Windows Explorer)
echo ==============================================
pause
