@echo off
setlocal enabledelayedexpansion

echo ========================================================
echo  Milk Reception App - Production VM Update (Branch 4.4)
echo ========================================================

REM Determine application working directory
if exist "%~dp0\.git" (
  cd /d "%~dp0"
) else (
  cd /d C:\app
)

echo Target directory: %CD%

REM Step 1 deletes every uncommitted change in this folder, so outside the server folder it asks first.
if /I not "%CD%"=="C:\app" (
  echo.
  echo [WARNING] This is not the server folder C:\app.
  echo This update deletes ALL uncommitted work in %CD%,
  echo and changes the database named in this folder's .env file.
  set "CONFIRM="
  set /p "CONFIRM=Type UPDATE to continue, or press Enter to stop: "
  if /I not "!CONFIRM!"=="UPDATE" (
    echo Stopped. Nothing was changed.
    pause
    exit /b 1
  )
)

echo.
echo [1/6] Force-syncing latest code from GitHub branch 4.4...
git fetch origin 4.4
if %errorlevel% neq 0 (
  echo [ERROR] git fetch failed! Check internet connection or repository access.
  pause
  exit /b %errorlevel%
)

git checkout -B 4.4 origin/4.4
git reset --hard origin/4.4
git branch -f main 4.4
git clean -fd -e .env -e .env.production -e .env.local

echo.
echo [2/6] Verifying and installing dependencies...
call npm install --no-audit --no-fund
if %errorlevel% neq 0 (
  echo [WARNING] npm install had warnings or non-zero exit; attempting to proceed.
)

echo.
echo [3/6] Syncing Database Schema (Tables, Columns, Indexes, Views)...
REM This updates the live PostgreSQL schema safely WITHOUT adding any dummy data
call node scripts/fix_vm_db.js
if %errorlevel% neq 0 (
  echo [ERROR] Database schema sync failed! Check database credentials in .env.
  pause
  exit /b %errorlevel%
)

REM Run Prisma migrations to ensure migration history alignment
call node node_modules/prisma/build/index.js migrate deploy
if %errorlevel% neq 0 (
  echo.
  echo [ERROR] Database migrations failed! The app was NOT rebuilt or restarted,
  echo so the running site still has its previous build. Please review the error above.
  pause
  exit /b %errorlevel%
)

echo.
echo [4/6] Regenerating Prisma Client with latest schema...
call node node_modules/prisma/build/index.js generate
if %errorlevel% neq 0 (
  echo [ERROR] Prisma generate failed!
  pause
  exit /b %errorlevel%
)

echo.
echo [5/6] Clean-building Next.js production app...
if exist .next rmdir /s /q .next
call npm run build
if %errorlevel% neq 0 (
  echo.
  echo [ERROR] Next.js build failed! Please review the compiler error above.
  pause
  exit /b %errorlevel%
)

echo.
echo [6/6] Restarting PM2 production services...
call pm2 restart all --update-env || call pm2 start ecosystem.config.js
call pm2 save

echo.
echo ========================================================
echo  Update Complete! Everything is ONLINE on branch 4.4.
echo  Database schema updated with NO dummy data.
echo  Please do a Hard Refresh (Ctrl + Shift + R)
echo  in your browser to view the latest changes.
echo ========================================================
pause
