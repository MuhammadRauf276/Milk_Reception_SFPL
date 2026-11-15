-- A ZMCC (or contractor) has one registered position: where it is on the map.
-- Mobile Tester journeys start and end here, and a fixed station with no GPS chip records this position.
ALTER TABLE "procurement_source"
  ADD COLUMN IF NOT EXISTS "latitude" DECIMAL(10, 7),
  ADD COLUMN IF NOT EXISTS "longitude" DECIMAL(10, 7);

-- The three ZMCCs whose positions used to be written in the application code. Only filled where still empty.
UPDATE "procurement_source" SET "latitude" = 29.6974, "longitude" = 72.5539 WHERE "code" = 'ZMCC-HASILPUR' AND "latitude" IS NULL;
UPDATE "procurement_source" SET "latitude" = 31.2698, "longitude" = 72.3169 WHERE "code" = 'ZMCC-JHANG' AND "latitude" IS NULL;
UPDATE "procurement_source" SET "latitude" = 30.4042, "longitude" = 71.8647 WHERE "code" = 'ZMCC-KABIRWALA' AND "latitude" IS NULL;
