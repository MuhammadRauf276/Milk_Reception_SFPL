-- Phase 3: Add creation_client_event_id to visit_portion and create operation_idempotency_record table

-- AlterTable
ALTER TABLE "visit_portion" ADD COLUMN "creation_client_event_id" VARCHAR(255);

-- CreateIndex
CREATE UNIQUE INDEX "visit_portion_creation_client_event_id_key" ON "visit_portion"("creation_client_event_id");

-- CreateTable
CREATE TABLE "operation_idempotency_record" (
    "id" BIGSERIAL NOT NULL,
    "key" VARCHAR(255) NOT NULL,
    "operation_type" VARCHAR(64) NOT NULL,
    "entity_type" VARCHAR(64) NOT NULL,
    "entity_id" BIGINT NOT NULL,
    "request_payload" JSONB,
    "response_payload" JSONB NOT NULL,
    "status_code" INTEGER NOT NULL DEFAULT 200,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operation_idempotency_record_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "operation_idempotency_record_key_key" ON "operation_idempotency_record"("key");

-- CreateIndex
CREATE INDEX "operation_idempotency_record_operation_type_entity_id_idx" ON "operation_idempotency_record"("operation_type", "entity_id");
