-- AlterTable
ALTER TABLE "procurement_source" ADD COLUMN IF NOT EXISTS "dispatch_quantity_policy" JSONB;

-- CreateTable
CREATE TABLE IF NOT EXISTS "dispatch_quantity_policy_snapshot" (
    "id" BIGSERIAL NOT NULL,
    "visit_id" BIGINT NOT NULL,
    "source_id" BIGINT NOT NULL,
    "policy_version" INTEGER NOT NULL DEFAULT 1,
    "policy_snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispatch_quantity_policy_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "dispatch_quantity_policy_snapshot_visit_id_key" ON "dispatch_quantity_policy_snapshot"("visit_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "dispatch_quantity_policy_snapshot_source_id_idx" ON "dispatch_quantity_policy_snapshot"("source_id");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dispatch_quantity_policy_snapshot_visit_id_fkey'
  ) THEN
    ALTER TABLE "dispatch_quantity_policy_snapshot"
    ADD CONSTRAINT "dispatch_quantity_policy_snapshot_visit_id_fkey"
    FOREIGN KEY ("visit_id") REFERENCES "vehicle_visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dispatch_quantity_policy_snapshot_source_id_fkey'
  ) THEN
    ALTER TABLE "dispatch_quantity_policy_snapshot"
    ADD CONSTRAINT "dispatch_quantity_policy_snapshot_source_id_fkey"
    FOREIGN KEY ("source_id") REFERENCES "procurement_source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

