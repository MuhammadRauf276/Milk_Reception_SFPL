CREATE TABLE "finance_loss_target" (
  "id" BIGSERIAL PRIMARY KEY,
  "metric" VARCHAR(50) NOT NULL,
  "target_percent" DECIMAL(7,4) NOT NULL,
  "effective_from" TIMESTAMP(6) NOT NULL,
  "effective_to" TIMESTAMP(6),
  "activated_by_user_id" BIGINT NOT NULL,
  "reason" TEXT NOT NULL,
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "finance_loss_target_metric_effective_from_effective_to_idx" ON "finance_loss_target"("metric", "effective_from", "effective_to");
