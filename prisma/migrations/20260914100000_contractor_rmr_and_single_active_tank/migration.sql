-- AlterTable: zmcc_contractor_arrival
-- Step 1: Add column with a safe backfill default for existing rows if any exist
ALTER TABLE "zmcc_contractor_arrival" ADD COLUMN "rmr_number" VARCHAR(100) DEFAULT 'RMR-HISTORICAL' NOT NULL;
-- Step 2: Remove default constraint so subsequent inserts must explicitly supply rmr_number
ALTER TABLE "zmcc_contractor_arrival" ALTER COLUMN "rmr_number" DROP DEFAULT;

-- Step 3: Deactivate duplicate active tanks per ZMCC, keeping the oldest tank active
WITH ranked_tanks AS (
  SELECT id, ROW_NUMBER() OVER(PARTITION BY zmcc_id ORDER BY id ASC) as rn
  FROM "zmcc_tank"
  WHERE is_active = TRUE
)
UPDATE "zmcc_tank"
SET is_active = FALSE
WHERE id IN (
  SELECT id FROM ranked_tanks WHERE rn > 1
);

-- Step 4: CreateIndex: partial unique index enforcing exactly one active tank per ZMCC
CREATE UNIQUE INDEX "zmcc_tank_one_active_per_zmcc_idx" ON "zmcc_tank" ("zmcc_id") WHERE is_active = TRUE;

