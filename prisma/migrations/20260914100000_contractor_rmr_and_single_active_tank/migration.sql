-- AlterTable: zmcc_contractor_arrival
-- Step 1: Add column rmr_number as nullable initially to allow safe migration inspection
ALTER TABLE "zmcc_contractor_arrival" ADD COLUMN "rmr_number" VARCHAR(100);

-- Step 2: Fail-fast guard for Contractor RMR database integrity
-- Historical unknown RMR must never be guessed or populated with fake placeholders.
-- Any pre-existing rows without a truthful, digits-only RMR require explicit resolution before migration.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "zmcc_contractor_arrival"
    WHERE "rmr_number" IS NULL OR TRIM("rmr_number") = '' OR "rmr_number" !~ '^[0-9]+$'
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce NOT NULL and digits-only constraint on zmcc_contractor_arrival.rmr_number: unresolved rows with missing, blank, or non-numeric RMR exist. Resolve historical data explicitly before migration.';
  END IF;
END $$;

-- Step 3: Enforce NOT NULL and digits-only CHECK constraint on canonical rmr_number column
ALTER TABLE "zmcc_contractor_arrival" ALTER COLUMN "rmr_number" SET NOT NULL;
ALTER TABLE "zmcc_contractor_arrival" ADD CONSTRAINT "zmcc_contractor_arrival_rmr_digits_check" CHECK ("rmr_number" ~ '^[0-9]+$');

-- Step 4: Fail-fast guard before creating partial unique index
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

-- Step 5: CreateIndex: partial unique index enforcing at most one active tank per ZMCC (operational service enforces exactly one required for milk reception)
CREATE UNIQUE INDEX "zmcc_tank_one_active_per_zmcc_idx" ON "zmcc_tank" ("zmcc_id") WHERE is_active = TRUE;
