ALTER TABLE "mot_shop_collection" ADD COLUMN IF NOT EXISTS "decision_details" JSONB;
ALTER TABLE "mot_journey" ADD COLUMN IF NOT EXISTS "assigned_as_role" VARCHAR(64);
ALTER TABLE "mot_journey" ADD COLUMN IF NOT EXISTS "assigned_is_delegated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "mot_journey" ADD COLUMN IF NOT EXISTS "cancelled_as_role" VARCHAR(64);
ALTER TABLE "mot_journey" ADD COLUMN IF NOT EXISTS "cancelled_is_delegated" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS "mot_shop_collection_zmcc_id_review_status_idx" ON "mot_shop_collection"("zmcc_id","review_status");
