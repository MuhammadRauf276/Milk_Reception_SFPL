-- Migration: Add explicit submitted_at columns and procurement_source_id FK relation
ALTER TABLE "gate_log" ADD COLUMN IF NOT EXISTS "entry_submitted_at" TIMESTAMP(6);
ALTER TABLE "gate_log" ADD COLUMN IF NOT EXISTS "exit_submitted_at" TIMESTAMP(6);

ALTER TABLE "weight_ticket" ADD COLUMN IF NOT EXISTS "gross_submitted_at" TIMESTAMP(6);
ALTER TABLE "weight_ticket" ADD COLUMN IF NOT EXISTS "tare_submitted_at" TIMESTAMP(6);

ALTER TABLE "unloading_log" ADD COLUMN IF NOT EXISTS "start_submitted_at" TIMESTAMP(6);
ALTER TABLE "unloading_log" ADD COLUMN IF NOT EXISTS "complete_submitted_at" TIMESTAMP(6);

ALTER TABLE "vehicle_visit" ADD COLUMN IF NOT EXISTS "procurement_source_id" BIGINT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_visit_procurement_source_id_fkey'
    ) THEN
        ALTER TABLE "vehicle_visit" ADD CONSTRAINT "vehicle_visit_procurement_source_id_fkey" FOREIGN KEY ("procurement_source_id") REFERENCES "procurement_source"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
