-- Align the database with optimistic-lock fields already used by the
-- MOT journey, MOT collection, and ZMCC tank services.
--
-- Existing rows start at version 1. Each service increments the value when
-- it successfully applies a guarded update.

ALTER TABLE "mot_journey"
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "mot_shop_collection"
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "zmcc_tank"
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

