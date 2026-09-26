CREATE TABLE "correction_request" (
  "id" BIGSERIAL NOT NULL,
  "correlation_id" VARCHAR(100) NOT NULL,
  "module" VARCHAR(80) NOT NULL,
  "record_id" VARCHAR(100) NOT NULL,
  "source_id" BIGINT,
  "impact" VARCHAR(20) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'REQUESTED',
  "reason" TEXT NOT NULL,
  "requested_changes" JSONB NOT NULL,
  "requested_by_user_id" BIGINT NOT NULL,
  "requested_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewed_by_user_id" BIGINT,
  "reviewed_at" TIMESTAMP(6),
  "review_reason" TEXT,
  CONSTRAINT "correction_request_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "correction_request_correlation_id_key" ON "correction_request"("correlation_id");
CREATE INDEX "correction_request_source_id_status_requested_at_idx" ON "correction_request"("source_id", "status", "requested_at");
CREATE INDEX "correction_request_module_record_id_idx" ON "correction_request"("module", "record_id");
ALTER TABLE "correction_request" ADD CONSTRAINT "correction_request_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "correction_request" ADD CONSTRAINT "correction_request_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
