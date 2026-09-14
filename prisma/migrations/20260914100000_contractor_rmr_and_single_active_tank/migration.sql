-- AlterTable: zmcc_contractor_arrival
-- Step 1: Add column allowing NULL for historical records without inventing fake data
ALTER TABLE "zmcc_contractor_arrival" ADD COLUMN "rmr_number" VARCHAR(100);

-- Step 2: Fail-fast guard before creating partial unique index
-- Never silently deactivate duplicate active tanks or mutate production tank data.
DO $$
BEGIN
  IF EXISTS (
    SELECT zmcc_id
    FROM "zmcc_tank"
    WHERE is_active = TRUE
    GROUP BY zmcc_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce one active tank per ZMCC: duplicate active tanks exist. Resolve configuration explicitly before migration.';
  END IF;
END $$;

-- Step 3: CreateIndex: partial unique index enforcing exactly one active tank per ZMCC
CREATE UNIQUE INDEX "zmcc_tank_one_active_per_zmcc_idx" ON "zmcc_tank" ("zmcc_id") WHERE is_active = TRUE;
