-- Migration: 20260910180000_mot_collection_offline_gps_map
-- Stage 6D: MOT Shop Collection, Offline Sync, GPS Tracking, SMS Outbox, and Manager Map

-- 1. Extend mot_journey_stop with snapshot columns
ALTER TABLE "mot_journey_stop" ADD COLUMN "shop_code_snapshot" VARCHAR(50);
ALTER TABLE "mot_journey_stop" ADD COLUMN "shop_name_snapshot" VARCHAR(255);
ALTER TABLE "mot_journey_stop" ADD COLUMN "owner_name_snapshot" VARCHAR(255);
ALTER TABLE "mot_journey_stop" ADD COLUMN "phone_number_snapshot" VARCHAR(50);
ALTER TABLE "mot_journey_stop" ADD COLUMN "area_code_snapshot" VARCHAR(50);
ALTER TABLE "mot_journey_stop" ADD COLUMN "area_name_snapshot" VARCHAR(255);
ALTER TABLE "mot_journey_stop" ADD COLUMN "planned_latitude_snapshot" DECIMAL(10, 7);
ALTER TABLE "mot_journey_stop" ADD COLUMN "planned_longitude_snapshot" DECIMAL(10, 7);

-- 2. Backfill existing mot_journey_stop rows from related zmcc_shop and zmcc_area
UPDATE "mot_journey_stop" js
SET 
  "shop_code_snapshot" = s."shop_code",
  "shop_name_snapshot" = s."shop_name",
  "owner_name_snapshot" = s."owner_name",
  "phone_number_snapshot" = s."phone_number",
  "area_code_snapshot" = a."area_code",
  "area_name_snapshot" = a."name",
  "planned_latitude_snapshot" = s."latitude",
  "planned_longitude_snapshot" = s."longitude"
FROM "zmcc_shop" s
JOIN "zmcc_area" a ON s."area_id" = a."id"
WHERE js."shop_id" = s."id";

-- Fallback for any orphaned rows
UPDATE "mot_journey_stop"
SET 
  "shop_code_snapshot" = COALESCE("shop_code_snapshot", 'UNKNOWN'),
  "shop_name_snapshot" = COALESCE("shop_name_snapshot", 'UNKNOWN'),
  "owner_name_snapshot" = COALESCE("owner_name_snapshot", 'UNKNOWN'),
  "phone_number_snapshot" = COALESCE("phone_number_snapshot", 'UNKNOWN'),
  "area_code_snapshot" = COALESCE("area_code_snapshot", 'UNKNOWN'),
  "area_name_snapshot" = COALESCE("area_name_snapshot", 'UNKNOWN')
WHERE "shop_code_snapshot" IS NULL;

-- 3. Enforce NOT NULL constraints on snapshot columns
ALTER TABLE "mot_journey_stop" ALTER COLUMN "shop_code_snapshot" SET NOT NULL;
ALTER TABLE "mot_journey_stop" ALTER COLUMN "shop_name_snapshot" SET NOT NULL;
ALTER TABLE "mot_journey_stop" ALTER COLUMN "owner_name_snapshot" SET NOT NULL;
ALTER TABLE "mot_journey_stop" ALTER COLUMN "phone_number_snapshot" SET NOT NULL;
ALTER TABLE "mot_journey_stop" ALTER COLUMN "area_code_snapshot" SET NOT NULL;
ALTER TABLE "mot_journey_stop" ALTER COLUMN "area_name_snapshot" SET NOT NULL;

-- 4. Create Sequence for Collection Number
CREATE SEQUENCE IF NOT EXISTS "mot_collection_number_seq" START WITH 1 INCREMENT BY 1;

-- 5. Create mot_shop_collection table
CREATE TABLE "mot_shop_collection" (
    "id" BIGSERIAL NOT NULL,
    "collection_number" VARCHAR(50) NOT NULL,
    "journey_id" BIGINT NOT NULL,
    "journey_stop_id" BIGINT NOT NULL,
    "shop_id" BIGINT NOT NULL,
    "zmcc_id" BIGINT NOT NULL,
    "route_id" BIGINT NOT NULL,
    "mot_profile_id" BIGINT NOT NULL,
    "mot_vehicle_id" BIGINT NOT NULL,
    "operational_date" DATE NOT NULL,
    "client_event_id" VARCHAR(255) NOT NULL,
    "quantity_value" DECIMAL(10, 2) NOT NULL,
    "quantity_unit" VARCHAR(10) NOT NULL,
    "gross_liters" DECIMAL(10, 2) NOT NULL,
    "density" DECIMAL(6, 4) NOT NULL,
    "lr" DECIMAL(5, 2) NOT NULL,
    "fat" DECIMAL(4, 2) NOT NULL,
    "snf" DECIMAL(5, 2) NOT NULL,
    "ts" DECIMAL(5, 2) NOT NULL,
    "at_13ts_liters" DECIMAL(10, 2) NOT NULL,
    "calculation_version" VARCHAR(20) NOT NULL DEFAULT '1.0',
    "collection_latitude" DECIMAL(10, 7) NOT NULL,
    "collection_longitude" DECIMAL(10, 7) NOT NULL,
    "collection_gps_accuracy" DECIMAL(8, 2),
    "device_collected_at" TIMESTAMP(6) NOT NULL,
    "server_received_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_by_user_id" BIGINT NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mot_shop_collection_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mot_shop_collection_quantity_value_check" CHECK ("quantity_value" > 0),
    CONSTRAINT "mot_shop_collection_quantity_unit_check" CHECK ("quantity_unit" IN ('LITER', 'KG')),
    CONSTRAINT "mot_shop_collection_gross_liters_check" CHECK ("gross_liters" > 0),
    CONSTRAINT "mot_shop_collection_gps_check" CHECK ("collection_latitude" BETWEEN -90 AND 90 AND "collection_longitude" BETWEEN -180 AND 180),
    CONSTRAINT "mot_shop_collection_lr_fat_check" CHECK ("lr" > 0 AND "fat" >= 0),
    CONSTRAINT "mot_shop_collection_calculated_nonneg_check" CHECK ("density" > 0 AND "snf" >= 0 AND "ts" >= 0 AND "at_13ts_liters" >= 0)
);

-- Unique constraints
CREATE UNIQUE INDEX "mot_shop_collection_collection_number_key" ON "mot_shop_collection"("collection_number");
CREATE UNIQUE INDEX "mot_shop_collection_journey_stop_id_key" ON "mot_shop_collection"("journey_stop_id");
CREATE UNIQUE INDEX "mot_shop_collection_client_event_id_key" ON "mot_shop_collection"("client_event_id");
CREATE UNIQUE INDEX "mot_shop_collection_journey_stop_composite_key" ON "mot_shop_collection"("journey_id", "journey_stop_id");

-- Performance indexes
CREATE INDEX "mot_shop_collection_journey_id_idx" ON "mot_shop_collection"("journey_id");
CREATE INDEX "mot_shop_collection_shop_id_idx" ON "mot_shop_collection"("shop_id");
CREATE INDEX "mot_shop_collection_zmcc_id_idx" ON "mot_shop_collection"("zmcc_id");
CREATE INDEX "mot_shop_collection_operational_date_idx" ON "mot_shop_collection"("operational_date");

-- Foreign Keys: mot_shop_collection
ALTER TABLE "mot_shop_collection" ADD CONSTRAINT "mot_shop_collection_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "mot_journey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mot_shop_collection" ADD CONSTRAINT "mot_shop_collection_journey_stop_id_fkey" FOREIGN KEY ("journey_stop_id") REFERENCES "mot_journey_stop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mot_shop_collection" ADD CONSTRAINT "mot_shop_collection_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "zmcc_shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mot_shop_collection" ADD CONSTRAINT "mot_shop_collection_zmcc_id_fkey" FOREIGN KEY ("zmcc_id") REFERENCES "procurement_source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mot_shop_collection" ADD CONSTRAINT "mot_shop_collection_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "zmcc_route"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mot_shop_collection" ADD CONSTRAINT "mot_shop_collection_mot_profile_id_fkey" FOREIGN KEY ("mot_profile_id") REFERENCES "mot_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mot_shop_collection" ADD CONSTRAINT "mot_shop_collection_mot_vehicle_id_fkey" FOREIGN KEY ("mot_vehicle_id") REFERENCES "mot_vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mot_shop_collection" ADD CONSTRAINT "mot_shop_collection_submitted_by_user_id_fkey" FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 6. Create mot_collection_sms_outbox table
CREATE TABLE "mot_collection_sms_outbox" (
    "id" BIGSERIAL NOT NULL,
    "collection_id" BIGINT NOT NULL,
    "recipient_phone" VARCHAR(50) NOT NULL,
    "message_body" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "provider_message_id" VARCHAR(255),
    "last_error" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(6),
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mot_collection_sms_outbox_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mot_collection_sms_outbox_status_check" CHECK ("status" IN ('PENDING', 'SENT', 'FAILED')),
    CONSTRAINT "mot_collection_sms_outbox_attempt_count_check" CHECK ("attempt_count" >= 0)
);

-- Unique constraint
CREATE UNIQUE INDEX "mot_collection_sms_outbox_collection_id_key" ON "mot_collection_sms_outbox"("collection_id");

-- Performance index
CREATE INDEX "mot_collection_sms_outbox_status_idx" ON "mot_collection_sms_outbox"("status");

-- Foreign Keys: mot_collection_sms_outbox
ALTER TABLE "mot_collection_sms_outbox" ADD CONSTRAINT "mot_collection_sms_outbox_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "mot_shop_collection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
