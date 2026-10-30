#!/bin/sh
set -e

echo "=========================================================="
echo " Starting Shakarganj Milk Reception Application Container "
echo "=========================================================="

# Database connection verification
if [ -n "$DATABASE_URL" ]; then
  echo "[entrypoint] Checking PostgreSQL connection..."
  MAX_RETRIES=30
  COUNT=0
  until node -e "
    const { Client } = require('pg');
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    client.connect()
      .then(() => { client.end(); process.exit(0); })
      .catch(() => process.exit(1));
  " 2>/dev/null; do
    COUNT=$((COUNT + 1))
    if [ $COUNT -ge $MAX_RETRIES ]; then
      echo "[entrypoint] ERROR: Database connection failed after $MAX_RETRIES attempts."
      exit 1
    fi
    echo "[entrypoint] Database not ready yet ($COUNT/$MAX_RETRIES). Retrying in 2s..."
    sleep 2
  done
  echo "[entrypoint] Database connection established successfully!"

  # Run Prisma migrations
  echo "[entrypoint] Running database migrations (prisma migrate deploy)..."
  node node_modules/prisma/build/index.js migrate deploy || {
    echo "[entrypoint] Warning: Prisma migrate deploy returned an error code. Check migration status."
  }

  # Run seed if RUN_SEED is enabled
  if [ "${RUN_SEED:-false}" = "true" ]; then
    echo "[entrypoint] RUN_SEED=true: running database seed..."
    npm run db:seed || echo "[entrypoint] Warning: Database seeding encountered an error."
  fi
fi

# Ensure storage directories exist
mkdir -p /app/data /app/storage/photos

# Start WhatsApp daemon if enabled
if [ "${ENABLE_WHATSAPP_GATEWAY:-true}" = "true" ]; then
  echo "[entrypoint] Starting WhatsApp gateway daemon on port ${WHATSAPP_GATEWAY_PORT:-3001}..."
  node scripts/whatsapp_service.js &
fi

# If no arguments provided, default to starting Next.js
if [ $# -eq 0 ]; then
  set -- npm run start
fi

echo "[entrypoint] Executing application: $@"
exec "$@"
