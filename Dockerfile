# ==============================================================================
# Multi-stage Dockerfile for Milk Reception Web Application & Services
# Node 22 (LTS) - Debian Bookworm Slim
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Dependencies
# ------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /app

# Install OpenSSL and certificates required by Prisma & Node
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency definitions and Prisma schema
COPY package.json package-lock.json ./
COPY prisma ./prisma/
COPY prisma.config.ts ./

# Provide build-time environment variables for Prisma 7 client generation
ENV DATABASE_URL="postgresql://postgres:postgres@localhost:5432/build_db?schema=public"

# Install npm dependencies (including devDependencies needed for build and Prisma)
RUN npm ci

# Generate Prisma Client
RUN node node_modules/prisma/build/index.js generate

# ------------------------------------------------------------------------------
# Stage 2: Application Builder
# ------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL="postgresql://postgres:postgres@localhost:5432/build_db?schema=public"
ENV JWT_SECRET="ci-dummy-jwt-secret-for-testing-only-12345"

# Build Next.js application
RUN npm run build

# ------------------------------------------------------------------------------
# Stage 3: Production Runner
# ------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Install runtime dependencies: OpenSSL (for Prisma), curl (for health checks)
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create persistent storage directories
RUN mkdir -p /app/data /app/storage/photos /app/public

# Copy application assets, build artifacts, scripts, and runtime modules
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.js ./next.config.js
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts

# Setup entrypoint script
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN sed -i 's/\r$//' ./docker-entrypoint.sh && chmod +x ./docker-entrypoint.sh

# Expose Next.js Web App (3000) and WhatsApp Gateway Daemon (3001)
EXPOSE 3000 3001

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["npm", "run", "start"]
