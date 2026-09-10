-- CreateTable: mot_profile
CREATE TABLE "mot_profile" (
    "id" BIGSERIAL NOT NULL,
    "mot_code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "phone_number" VARCHAR(30) NOT NULL,
    "cnic" VARCHAR(30) NOT NULL,
    "zmcc_id" BIGINT NOT NULL,
    "user_id" BIGINT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" BIGINT NOT NULL,
    "updated_by" BIGINT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mot_profile_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mot_profile_mot_code_key" UNIQUE ("mot_code"),
    CONSTRAINT "mot_profile_user_id_key" UNIQUE ("user_id"),
    CONSTRAINT "mot_profile_id_zmcc_id_key" UNIQUE ("id", "zmcc_id"),
    CONSTRAINT "ck_mot_profile_code_non_empty" CHECK (length(trim("mot_code")) > 0),
    CONSTRAINT "ck_mot_profile_name_non_empty" CHECK (length(trim("name")) > 0),
    CONSTRAINT "ck_mot_profile_phone_format" CHECK ("phone_number" ~ '^(\+92-?|92-?|0)?3[0-9]{2}-?[0-9]{7}$'),
    CONSTRAINT "ck_mot_profile_cnic_format" CHECK ("cnic" ~ '^([0-9]{13}|[0-9]{5}-[0-9]{7}-[0-9])$')
);

-- CreateTable: mot_vehicle
CREATE TABLE "mot_vehicle" (
    "id" BIGSERIAL NOT NULL,
    "vehicle_number" VARCHAR(50) NOT NULL,
    "zmcc_id" BIGINT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" BIGINT NOT NULL,
    "updated_by" BIGINT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mot_vehicle_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mot_vehicle_vehicle_number_key" UNIQUE ("vehicle_number"),
    CONSTRAINT "mot_vehicle_id_zmcc_id_key" UNIQUE ("id", "zmcc_id"),
    CONSTRAINT "ck_mot_vehicle_number_non_empty" CHECK (length(trim("vehicle_number")) > 0)
);

-- CreateTable: mot_journey
CREATE TABLE "mot_journey" (
    "id" BIGSERIAL NOT NULL,
    "journey_number" VARCHAR(50) NOT NULL,
    "operational_date" DATE NOT NULL,
    "zmcc_id" BIGINT NOT NULL,
    "route_id" BIGINT NOT NULL,
    "mot_profile_id" BIGINT NOT NULL,
    "mot_vehicle_id" BIGINT NOT NULL,
    "status" VARCHAR(50) NOT NULL DEFAULT 'COLLECTING',
    "assigned_by" BIGINT NOT NULL,
    "assigned_at" TIMESTAMP(6) NOT NULL,
    "assignment_latitude" DECIMAL(10, 7) NOT NULL,
    "assignment_longitude" DECIMAL(10, 7) NOT NULL,
    "assignment_gps_accuracy" DECIMAL(8, 2),
    "started_at" TIMESTAMP(6) NOT NULL,
    "start_latitude" DECIMAL(10, 7) NOT NULL,
    "start_longitude" DECIMAL(10, 7) NOT NULL,
    "first_mot_gps_at" TIMESTAMP(6),
    "first_mot_latitude" DECIMAL(10, 7),
    "first_mot_longitude" DECIMAL(10, 7),
    "first_mot_gps_accuracy" DECIMAL(8, 2),
    "idempotency_key" VARCHAR(255) NOT NULL,
    "ended_at" TIMESTAMP(6),
    "cancelled_by" BIGINT,
    "cancelled_at" TIMESTAMP(6),
    "cancellation_reason" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mot_journey_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mot_journey_journey_number_key" UNIQUE ("journey_number"),
    CONSTRAINT "mot_journey_idempotency_key_key" UNIQUE ("idempotency_key"),
    CONSTRAINT "mot_journey_id_zmcc_id_key" UNIQUE ("id", "zmcc_id"),
    CONSTRAINT "ck_mot_journey_number_non_empty" CHECK (length(trim("journey_number")) > 0),
    CONSTRAINT "ck_mot_journey_status_valid" CHECK ("status" IN ('COLLECTING', 'ARRIVED', 'COMPLETED', 'CANCELLED')),
    CONSTRAINT "ck_mot_journey_cancellation_reason" CHECK ("status" != 'CANCELLED' OR ("cancellation_reason" IS NOT NULL AND length(trim("cancellation_reason")) > 0)),
    CONSTRAINT "ck_mot_journey_assignment_gps_range" CHECK ("assignment_latitude" >= -90 AND "assignment_latitude" <= 90 AND "assignment_longitude" >= -180 AND "assignment_longitude" <= 180),
    CONSTRAINT "ck_mot_journey_start_gps_range" CHECK ("start_latitude" >= -90 AND "start_latitude" <= 90 AND "start_longitude" >= -180 AND "start_longitude" <= 180),
    CONSTRAINT "ck_mot_journey_first_mot_gps" CHECK (("first_mot_latitude" IS NULL AND "first_mot_longitude" IS NULL AND "first_mot_gps_at" IS NULL) OR ("first_mot_latitude" IS NOT NULL AND "first_mot_longitude" IS NOT NULL AND "first_mot_gps_at" IS NOT NULL AND "first_mot_latitude" >= -90 AND "first_mot_latitude" <= 90 AND "first_mot_longitude" >= -180 AND "first_mot_longitude" <= 180))
);

-- Partial unique indexes to prevent concurrent active COLLECTING journeys
CREATE UNIQUE INDEX "idx_mot_journey_profile_collecting" ON "mot_journey"("mot_profile_id") WHERE "status" = 'COLLECTING';
CREATE UNIQUE INDEX "idx_mot_journey_vehicle_collecting" ON "mot_journey"("mot_vehicle_id") WHERE "status" = 'COLLECTING';

-- CreateTable: mot_journey_stop
CREATE TABLE "mot_journey_stop" (
    "id" BIGSERIAL NOT NULL,
    "journey_id" BIGINT NOT NULL,
    "shop_id" BIGINT NOT NULL,
    "planned_sequence" INTEGER NOT NULL,
    "status" VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    "arrived_at" TIMESTAMP(6),
    "completed_at" TIMESTAMP(6),
    "skipped_at" TIMESTAMP(6),
    "skip_reason" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mot_journey_stop_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mot_journey_stop_journey_id_shop_id_key" UNIQUE ("journey_id", "shop_id"),
    CONSTRAINT "mot_journey_stop_journey_id_planned_sequence_key" UNIQUE ("journey_id", "planned_sequence"),
    CONSTRAINT "ck_mot_journey_stop_status_valid" CHECK ("status" IN ('PENDING', 'VISITED', 'SKIPPED'))
);

-- CreateTable: mot_journey_location
CREATE TABLE "mot_journey_location" (
    "id" BIGSERIAL NOT NULL,
    "journey_id" BIGINT NOT NULL,
    "recorded_by_user_id" BIGINT,
    "source_type" VARCHAR(50) NOT NULL,
    "latitude" DECIMAL(10, 7) NOT NULL,
    "longitude" DECIMAL(10, 7) NOT NULL,
    "gps_accuracy" DECIMAL(8, 2),
    "device_recorded_at" TIMESTAMP(6) NOT NULL,
    "server_received_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mot_journey_location_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mot_journey_location_idempotency_key_key" UNIQUE ("idempotency_key"),
    CONSTRAINT "ck_mot_journey_location_source_type" CHECK ("source_type" IN ('ASSIGNING_USER', 'MOT_DEVICE')),
    CONSTRAINT "ck_mot_journey_location_gps_range" CHECK ("latitude" >= -90 AND "latitude" <= 90 AND "longitude" >= -180 AND "longitude" <= 180)
);

-- Indexes
CREATE INDEX "mot_profile_zmcc_id_idx" ON "mot_profile"("zmcc_id");
CREATE INDEX "mot_vehicle_zmcc_id_idx" ON "mot_vehicle"("zmcc_id");
CREATE INDEX "mot_journey_zmcc_id_idx" ON "mot_journey"("zmcc_id");
CREATE INDEX "mot_journey_route_id_idx" ON "mot_journey"("route_id");
CREATE INDEX "mot_journey_mot_profile_id_idx" ON "mot_journey"("mot_profile_id");
CREATE INDEX "mot_journey_mot_vehicle_id_idx" ON "mot_journey"("mot_vehicle_id");
CREATE INDEX "mot_journey_status_idx" ON "mot_journey"("status");
CREATE INDEX "mot_journey_operational_date_idx" ON "mot_journey"("operational_date");
CREATE INDEX "mot_journey_stop_journey_id_idx" ON "mot_journey_stop"("journey_id");
CREATE INDEX "mot_journey_stop_shop_id_idx" ON "mot_journey_stop"("shop_id");
CREATE INDEX "mot_journey_location_journey_id_idx" ON "mot_journey_location"("journey_id");
CREATE INDEX "mot_journey_location_device_recorded_at_idx" ON "mot_journey_location"("device_recorded_at");

-- Foreign Keys: mot_profile
ALTER TABLE "mot_profile" ADD CONSTRAINT "mot_profile_zmcc_id_fkey" FOREIGN KEY ("zmcc_id") REFERENCES "procurement_source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mot_profile" ADD CONSTRAINT "mot_profile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "mot_profile" ADD CONSTRAINT "mot_profile_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mot_profile" ADD CONSTRAINT "mot_profile_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Foreign Keys: mot_vehicle
ALTER TABLE "mot_vehicle" ADD CONSTRAINT "mot_vehicle_zmcc_id_fkey" FOREIGN KEY ("zmcc_id") REFERENCES "procurement_source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mot_vehicle" ADD CONSTRAINT "mot_vehicle_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mot_vehicle" ADD CONSTRAINT "mot_vehicle_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Foreign Keys: mot_journey (Composite relations enforcing same ZMCC)
ALTER TABLE "mot_journey" ADD CONSTRAINT "mot_journey_zmcc_id_fkey" FOREIGN KEY ("zmcc_id") REFERENCES "procurement_source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mot_journey" ADD CONSTRAINT "mot_journey_route_id_zmcc_id_fkey" FOREIGN KEY ("route_id", "zmcc_id") REFERENCES "zmcc_route"("id", "zmcc_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mot_journey" ADD CONSTRAINT "mot_journey_mot_profile_id_zmcc_id_fkey" FOREIGN KEY ("mot_profile_id", "zmcc_id") REFERENCES "mot_profile"("id", "zmcc_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mot_journey" ADD CONSTRAINT "mot_journey_mot_vehicle_id_zmcc_id_fkey" FOREIGN KEY ("mot_vehicle_id", "zmcc_id") REFERENCES "mot_vehicle"("id", "zmcc_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mot_journey" ADD CONSTRAINT "mot_journey_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mot_journey" ADD CONSTRAINT "mot_journey_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Foreign Keys: mot_journey_stop
ALTER TABLE "mot_journey_stop" ADD CONSTRAINT "mot_journey_stop_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "mot_journey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mot_journey_stop" ADD CONSTRAINT "mot_journey_stop_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "zmcc_shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Foreign Keys: mot_journey_location
ALTER TABLE "mot_journey_location" ADD CONSTRAINT "mot_journey_location_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "mot_journey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mot_journey_location" ADD CONSTRAINT "mot_journey_location_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Sequence for concurrent atomic journey number generation
CREATE SEQUENCE IF NOT EXISTS "mot_journey_number_seq" START WITH 1 INCREMENT BY 1;
