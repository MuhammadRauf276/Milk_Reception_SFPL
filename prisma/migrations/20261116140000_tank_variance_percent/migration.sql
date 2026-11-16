-- ZMCC tank check on @13 TS: the testing allowance (percent of the dispatch's @13 TS litres) a dispatch may exceed
-- the @13 TS book stock by. A setting, not stored data. Default 0.5.
ALTER TABLE "zmcc_weighing_policy" ADD COLUMN IF NOT EXISTS "tank_variance_percent" DECIMAL(5,2) NOT NULL DEFAULT 0.5;
