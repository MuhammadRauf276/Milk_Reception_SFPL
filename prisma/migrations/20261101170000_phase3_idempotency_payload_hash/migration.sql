-- AlterTable
ALTER TABLE "operation_idempotency_record" ADD COLUMN IF NOT EXISTS "payload_hash" VARCHAR(64);
