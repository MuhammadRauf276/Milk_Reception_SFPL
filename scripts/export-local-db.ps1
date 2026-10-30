<#
.SYNOPSIS
  Exports the local PostgreSQL database to an SQL backup file.
.DESCRIPTION
  This script creates a plain-text SQL dump of the milk_reception_db database
  that can easily be imported into the Docker container running inside the Virtual Machine.
#>

$ErrorActionPreference = "Stop"

$OutputFile = Join-Path $PSScriptRoot "..\milk_reception_backup.sql"
$DbName = "milk_reception_db"
$DbUser = "postgres"
$DbHost = "localhost"
$DbPort = "5432"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " Milk Reception - Export Local Database   " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# Locate pg_dump
$PgDumpPath = (Get-Command pg_dump -ErrorAction SilentlyContinue)?.Source
if (-not $PgDumpPath) {
    $KnownPaths = @(
        "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe",
        "C:\Program Files\PostgreSQL\17\bin\pg_dump.exe",
        "C:\Program Files\PostgreSQL\16\bin\pg_dump.exe"
    )
    foreach ($path in $KnownPaths) {
        if (Test-Path $path) {
            $PgDumpPath = $path
            break
        }
    }
}

if (-not $PgDumpPath) {
    Write-Error "pg_dump.exe was not found. Please ensure PostgreSQL is installed or add pg_dump to your PATH."
}

Write-Host "Using pg_dump: $PgDumpPath" -ForegroundColor Green
Write-Host "Exporting database '$DbName' from $DbHost:$DbPort..." -ForegroundColor Yellow

# Set password if stored in .env or prompt
$EnvFile = Join-Path $PSScriptRoot "..\.env"
if (Test-Path $EnvFile) {
    Get-Content $EnvFile | ForEach-Object {
        if ($_ -match 'DATABASE_URL="postgresql://([^:]+):([^@]+)@') {
            $env:PGPASSWORD = $matches[2]
            $DbUser = $matches[1]
        }
    }
}

& $PgDumpPath -h $DbHost -p $DbPort -U $DbUser -d $DbName --clean --if-exists --no-owner --no-privileges -f $OutputFile

if ($LASTEXITCODE -eq 0 -and (Test-Path $OutputFile)) {
    $size = (Get-Item $OutputFile).Length / 1MB
    Write-Host ""
    Write-Host "Database export completed successfully!" -ForegroundColor Green
    Write-Host "File created: $OutputFile ($([math]::Round($size, 2)) MB)" -ForegroundColor White
    Write-Host "You can now copy this file to your Virtual Machine." -ForegroundColor Yellow
} else {
    Write-Error "Database export failed."
}
