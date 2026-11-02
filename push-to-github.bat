@echo off
setlocal enabledelayedexpansion

echo ==============================================
echo  Milk Reception App - 1-Click Push to GitHub
echo ==============================================

cd /d "%~dp0"

echo.
echo [1/3] Staging changes...
git add -A

set HAS_CHANGES=0
for /f "tokens=*" %%i in ('git status --porcelain') do set HAS_CHANGES=1

if "!HAS_CHANGES!"=="0" (
  echo No uncommitted changes detected. Proceeding to push branches...
) else (
  set /p msg="Enter commit message (or press ENTER for default): "
  if "!msg!"=="" set msg=feat(phase-4.4): production db schema sync without dummy data and update bat hardening
  echo.
  echo [2/3] Committing changes...
  git commit -m "!msg!"
)

echo.
echo [3/3] Pushing to GitHub (4.4, feature/phase-4.4, and main)...
git branch -f 4.4 HEAD
git branch -f feature/phase-4.4 HEAD
git branch -f main HEAD

echo Pushing branch 4.4...
git push origin 4.4 --force
echo Pushing branch feature/phase-4.4...
git push origin feature/phase-4.4 --force
echo Pushing branch main...
git push origin main --force

echo ==============================================
echo  Pushed to GitHub Successfully (4.4, feature/phase-4.4, and main)!
echo.
echo  NEXT STEP ON VIRTUAL MACHINE:
echo  1. Connect to VM desktop.
echo  2. Open PowerShell in C:\app and run:
echo     .\update.bat
echo     (or double-click C:\app\update.bat in Windows Explorer)
echo ==============================================
pause
