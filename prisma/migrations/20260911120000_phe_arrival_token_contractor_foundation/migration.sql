-- Migration: 20260911120000_phe_arrival_token_contractor_foundation
-- Stage 6E: PHE ZMCC Arrival, Token Generation, MOT Journey Completion & Contractor Arrival Foundation

-- 1. Add final MOT GPS snapshot columns to mot_journey
ALTER TABLE "mot_journey" ADD COLUMN "final_mot_gps_at" TIMESTAMP(6);
ALTER TABLE "mot_journey" ADD COLUMN "final_mot_latitude" DECIMAL(10, 7);
ALTER TABLE "mot_journey" ADD COLUMN "final_mot_longitude" DECIMAL(10, 7);
ALTER TABLE "mot_journey" ADD COLUMN "final_mot_gps_accuracy" DECIMAL(8, 2);

-- 2. Create Sequence for System ZMCC Token Generation
CREATE SEQUENCE IF NOT EXISTS "zmcc_token_seq" START WITH 1 INCREMENT BY 1;

-- 3. Create Table: zmcc_mot_arrival
CREATE TABLE "zmcc_mot_arrival" (
    "id" BIGSERIAL NOT NULL,
    "journey_id" BIGINT NOT NULL,
    "zmcc_id" BIGINT NOT NULL,
    "route_milk_token" VARCHAR(100) NOT NULL,
    "zmcc_token" VARCHAR(100) NOT NULL,
    "arrival_timestamp" TIMESTAMP(6) NOT NULL,
    "arrival_date" DATE NOT NULL,
    "phe_latitude" DECIMAL(10, 7),
    "phe_longitude" DECIMAL(10, 7),
    "phe_gps_accuracy" DECIMAL(8, 2),
    "client_event_id" VARCHAR(255) NOT NULL,
    "recorded_by_user_id" BIGINT NOT NULL,
    "submitted_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "correction_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zmcc_mot_arrival_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "zmcc_mot_arrival_gps_check" CHECK (
        ("phe_latitude" IS NULL AND "phe_longitude" IS NULL) OR
        ("phe_latitude" IS NOT NULL AND "phe_longitude" IS NOT NULL AND "phe_latitude" BETWEEN -90 AND 90 AND "phe_longitude" BETWEEN -180 AND 180 AND NOT ("phe_latitude" = 0 AND "phe_longitude" = 0))
    ),
    CONSTRAINT "zmcc_mot_arrival_correction_count_check" CHECK ("correction_count" >= 0 AND "correction_count" <= 2)
);

-- Unique constraints & indexes for zmcc_mot_arrival
CREATE UNIQUE INDEX "zmcc_mot_arrival_journey_id_key" ON "zmcc_mot_arrival"("journey_id");
CREATE UNIQUE INDEX "zmcc_mot_arrival_zmcc_token_key" ON "zmcc_mot_arrival"("zmcc_token");
CREATE UNIQUE INDEX "zmcc_mot_arrival_client_event_id_key" ON "zmcc_mot_arrival"("client_event_id");
CREATE INDEX "zmcc_mot_arrival_zmcc_id_idx" ON "zmcc_mot_arrival"("zmcc_id");
CREATE INDEX "zmcc_mot_arrival_arrival_date_idx" ON "zmcc_mot_arrival"("arrival_date");

-- Foreign key constraints for zmcc_mot_arrival
ALTER TABLE "zmcc_mot_arrival" ADD CONSTRAINT "zmcc_mot_arrival_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "mot_journey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "zmcc_mot_arrival" ADD CONSTRAINT "zmcc_mot_arrival_zmcc_id_fkey" FOREIGN KEY ("zmcc_id") REFERENCES "procurement_source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "zmcc_mot_arrival" ADD CONSTRAINT "zmcc_mot_arrival_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. Create Table: zmcc_contractor_arrival
CREATE TABLE "zmcc_contractor_arrival" (
    "id" BIGSERIAL NOT NULL,
    "zmcc_id" BIGINT NOT NULL,
    "contractor_source_id" BIGINT NOT NULL,
    "vehicle_number" VARCHAR(50) NOT NULL,
    "arrival_timestamp" TIMESTAMP(6) NOT NULL,
    "arrival_date" DATE NOT NULL,
    "zmcc_token" VARCHAR(100) NOT NULL,
    "phe_latitude" DECIMAL(10, 7),
    "phe_longitude" DECIMAL(10, 7),
    "phe_gps_accuracy" DECIMAL(8, 2),
    "client_event_id" VARCHAR(255) NOT NULL,
    "recorded_by_user_id" BIGINT NOT NULL,
    "submitted_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "correction_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zmcc_contractor_arrival_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "zmcc_contractor_arrival_gps_check" CHECK (
        ("phe_latitude" IS NULL AND "phe_longitude" IS NULL) OR
        ("phe_latitude" IS NOT NULL AND "phe_longitude" IS NOT NULL AND "phe_latitude" BETWEEN -90 AND 90 AND "phe_longitude" BETWEEN -180 AND 180 AND NOT ("phe_latitude" = 0 AND "phe_longitude" = 0))
    ),
    CONSTRAINT "zmcc_contractor_arrival_correction_count_check" CHECK ("correction_count" >= 0 AND "correction_count" <= 2)
);

-- Unique constraints & indexes for zmcc_contractor_arrival
CREATE UNIQUE INDEX "zmcc_contractor_arrival_zmcc_token_key" ON "zmcc_contractor_arrival"("zmcc_token");
CREATE UNIQUE INDEX "zmcc_contractor_arrival_client_event_id_key" ON "zmcc_contractor_arrival"("client_event_id");
CREATE INDEX "zmcc_contractor_arrival_zmcc_id_idx" ON "zmcc_contractor_arrival"("zmcc_id");
CREATE INDEX "zmcc_contractor_arrival_contractor_source_id_idx" ON "zmcc_contractor_arrival"("contractor_source_id");
CREATE INDEX "zmcc_contractor_arrival_arrival_date_idx" ON "zmcc_contractor_arrival"("arrival_date");

-- Foreign key constraints for zmcc_contractor_arrival
ALTER TABLE "zmcc_contractor_arrival" ADD CONSTRAINT "zmcc_contractor_arrival_zmcc_id_fkey" FOREIGN KEY ("zmcc_id") REFERENCES "procurement_source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "zmcc_contractor_arrival" ADD CONSTRAINT "zmcc_contractor_arrival_contractor_source_id_fkey" FOREIGN KEY ("contractor_source_id") REFERENCES "procurement_source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "zmcc_contractor_arrival" ADD CONSTRAINT "zmcc_contractor_arrival_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
