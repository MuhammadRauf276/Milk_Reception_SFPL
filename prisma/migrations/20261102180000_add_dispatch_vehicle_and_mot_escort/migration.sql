-- AlterTable
ALTER TABLE "vehicle_visit" ADD COLUMN IF NOT EXISTS "mot_vehicle_id" BIGINT;
ALTER TABLE "vehicle_visit" ADD COLUMN IF NOT EXISTS "mot_profile_id" BIGINT;
ALTER TABLE "vehicle_visit" ADD COLUMN IF NOT EXISTS "driver_name" VARCHAR(150);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "vehicle_visit_mot_vehicle_id_idx" ON "vehicle_visit"("mot_vehicle_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "vehicle_visit_mot_profile_id_idx" ON "vehicle_visit"("mot_profile_id");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_visit_mot_vehicle_id_fkey'
  ) THEN
    ALTER TABLE "vehicle_visit" ADD CONSTRAINT "vehicle_visit_mot_vehicle_id_fkey" FOREIGN KEY ("mot_vehicle_id") REFERENCES "mot_vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_visit_mot_profile_id_fkey'
  ) THEN
    ALTER TABLE "vehicle_visit" ADD CONSTRAINT "vehicle_visit_mot_profile_id_fkey" FOREIGN KEY ("mot_profile_id") REFERENCES "mot_profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
