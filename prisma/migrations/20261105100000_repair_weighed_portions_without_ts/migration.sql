-- Lab portions decided without a quantity saved LR and Fat but no density, SNF or TS. Weighing then booked their milk
-- into the tank with gross litres and 0 litres @13% TS. This works those values out from the portion's own LR and Fat,
-- with the same formulas as the app. Gross litres do not change. Rows that already have TS are not touched, so it is
-- safe to repeat.
CREATE TEMP TABLE "_portion_ts_fix" AS
SELECT p."id", p."lab_session_id", p."net_weight_kg",
       ROUND(1 + p."lr" / 1000, 4) AS "density",
       ROUND(p."lr" / 4 + 0.22 * p."fat" + 0.72, 2) AS "snf",
       ROUND(p."fat" + p."lr" / 4 + 0.22 * p."fat" + 0.72, 2) AS "ts"
FROM "zmcc_lab_portion" p
WHERE p."status" = 'WEIGHED' AND p."ts" IS NULL AND p."lr" > 0 AND p."fat" IS NOT NULL AND p."net_weight_kg" > 0;

-- The record of what changed, written before the values move.
INSERT INTO "audit_log" ("table_name", "record_id", "action", "old_values", "new_values")
SELECT 'zmcc_tank_inventory_transaction', x."id", 'REPAIR_AT13TS_FROM_LR_FAT',
       jsonb_build_object('at_13ts_liters', x."at_13ts_liters"),
       jsonb_build_object('at_13ts_liters', ROUND(x."quantity_liters" * f."ts" / 13, 2), 'portion_id', f."id"::text, 'ts', f."ts")
FROM "zmcc_tank_inventory_transaction" x
JOIN "_portion_ts_fix" f ON x."reference_type" = 'ZMCC_LAB_PORTION' AND x."reference_id" = f."id"::text
WHERE x."at_13ts_liters" = 0;

-- 1. The tank ledger: this is what corrects the @13% stock.
UPDATE "zmcc_tank_inventory_transaction" x
SET "at_13ts_liters" = ROUND(x."quantity_liters" * f."ts" / 13, 2)
FROM "_portion_ts_fix" f
WHERE x."reference_type" = 'ZMCC_LAB_PORTION' AND x."reference_id" = f."id"::text AND x."at_13ts_liters" = 0;

-- 2. The portions.
UPDATE "zmcc_lab_portion" p
SET "density" = f."density", "snf" = f."snf", "ts" = f."ts",
    "gross_liters" = x."quantity_liters", "at_13ts_liters" = x."at_13ts_liters"
FROM "_portion_ts_fix" f
JOIN "zmcc_tank_inventory_transaction" x ON x."reference_type" = 'ZMCC_LAB_PORTION' AND x."reference_id" = f."id"::text
WHERE p."id" = f."id";

-- 3. Each vehicle's totals, from all of its weighed portions.
CREATE TEMP TABLE "_session_ts_fix" AS
SELECT p."lab_session_id",
       SUM(p."gross_liters") AS "gross", SUM(p."at_13ts_liters") AS "at13",
       ROUND(SUM(p."density" * p."net_weight_kg") / NULLIF(SUM(p."net_weight_kg"), 0), 4) AS "density",
       ROUND(SUM(p."snf" * p."net_weight_kg") / NULLIF(SUM(p."net_weight_kg"), 0), 2) AS "snf",
       ROUND(SUM(p."ts" * p."net_weight_kg") / NULLIF(SUM(p."net_weight_kg"), 0), 2) AS "ts"
FROM "zmcc_lab_portion" p
WHERE p."status" = 'WEIGHED' AND p."lab_session_id" IN (SELECT "lab_session_id" FROM "_portion_ts_fix")
GROUP BY p."lab_session_id";

UPDATE "zmcc_tank_receipt" r
SET "at_13ts_liters" = s."at13", "density" = s."density", "snf" = s."snf", "ts" = s."ts"
FROM "_session_ts_fix" s
WHERE r."lab_session_id" = s."lab_session_id";

UPDATE "zmcc_lab_session" l
SET "gross_liters" = s."gross", "at_13ts_liters" = s."at13", "density" = s."density", "snf" = s."snf", "ts" = s."ts"
FROM "_session_ts_fix" s
WHERE l."id" = s."lab_session_id";

-- 4. Mobile Tester loss or gain @13% TS on those journeys.
UPDATE "mot_journey" j
SET "area_received_at_13ts_liters" = s."at13",
    "area_loss_gain_at_13ts_liters" = ROUND(s."at13" - j."area_mot_declared_at_13ts_liters", 2)
FROM "_session_ts_fix" s
JOIN "zmcc_lab_session" l ON l."id" = s."lab_session_id"
JOIN "zmcc_mot_arrival" a ON a."id" = l."mot_arrival_id"
WHERE j."id" = a."journey_id" AND j."area_computed_at" IS NOT NULL;

DROP TABLE "_session_ts_fix";
DROP TABLE "_portion_ts_fix";

-- The new HC notification opened a page the Zonal Manager cannot use.
UPDATE "notification"
SET "deep_link" = '/mpd/zmcc-manager?tab=APPROVALS'
WHERE "event_key" = 'HC_APPROVAL_PENDING' AND "deep_link" = '/zmcc';
