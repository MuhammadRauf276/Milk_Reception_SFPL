#!/bin/bash
set -e

BACKUP_FILE="${1:-milk_reception_backup.sql}"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Error: Backup file '$BACKUP_FILE' not found."
  echo "Usage: ./scripts/import-db-docker.sh [path/to/backup.sql]"
  exit 1
fi

echo "Importing '$BACKUP_FILE' into milk_reception_postgres container..."

# Check docker compose command
COMPOSE_CMD="docker compose"
if ! docker compose version &> /dev/null; then
  COMPOSE_CMD="docker-compose"
fi

# Load DB credentials from .env if present
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

DB_USER="${POSTGRES_USER:-postgres}"
DB_NAME="${POSTGRES_DB:-milk_reception_db}"

echo "Target Database: $DB_NAME (User: $DB_USER)"

docker exec -i milk_reception_postgres psql -U "$DB_USER" -d "$DB_NAME" < "$BACKUP_FILE"

echo "Database restore completed successfully!"
