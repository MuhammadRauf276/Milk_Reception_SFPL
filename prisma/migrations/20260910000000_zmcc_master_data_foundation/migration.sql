-- CreateTable: chiller_ownership
CREATE TABLE "chiller_ownership" (
    "id" BIGSERIAL NOT NULL,
    "ownership_code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" BIGINT NOT NULL,
    "updated_by" BIGINT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chiller_ownership_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chiller_ownership_ownership_code_key" UNIQUE ("ownership_code"),
    CONSTRAINT "chiller_ownership_name_key" UNIQUE ("name"),
    CONSTRAINT "ck_chiller_ownership_code_non_empty" CHECK (length(trim("ownership_code")) > 0),
    CONSTRAINT "ck_chiller_ownership_name_non_empty" CHECK (length(trim("name")) > 0)
);

-- CreateTable: zmcc_route
CREATE TABLE "zmcc_route" (
    "id" BIGSERIAL NOT NULL,
    "route_code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "origin" VARCHAR(150) NOT NULL,
    "destination" VARCHAR(150) NOT NULL,
    "zmcc_id" BIGINT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" BIGINT NOT NULL,
    "updated_by" BIGINT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zmcc_route_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "zmcc_route_route_code_key" UNIQUE ("route_code"),
    CONSTRAINT "zmcc_route_zmcc_id_name_key" UNIQUE ("zmcc_id", "name"),
    CONSTRAINT "zmcc_route_id_zmcc_id_key" UNIQUE ("id", "zmcc_id"),
    CONSTRAINT "ck_zmcc_route_code_non_empty" CHECK (length(trim("route_code")) > 0),
    CONSTRAINT "ck_zmcc_route_name_non_empty" CHECK (length(trim("name")) > 0),
    CONSTRAINT "ck_zmcc_route_origin_non_empty" CHECK (length(trim("origin")) > 0),
    CONSTRAINT "ck_zmcc_route_destination_non_empty" CHECK (length(trim("destination")) > 0)
);

-- CreateTable: zmcc_area
CREATE TABLE "zmcc_area" (
    "id" BIGSERIAL NOT NULL,
    "area_code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "route_id" BIGINT NOT NULL,
    "zmcc_id" BIGINT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" BIGINT NOT NULL,
    "updated_by" BIGINT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zmcc_area_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "zmcc_area_area_code_key" UNIQUE ("area_code"),
    CONSTRAINT "zmcc_area_route_id_name_key" UNIQUE ("route_id", "name"),
    CONSTRAINT "zmcc_area_id_route_id_zmcc_id_key" UNIQUE ("id", "route_id", "zmcc_id"),
    CONSTRAINT "ck_zmcc_area_code_non_empty" CHECK (length(trim("area_code")) > 0),
    CONSTRAINT "ck_zmcc_area_name_non_empty" CHECK (length(trim("name")) > 0)
);

-- CreateTable: zmcc_milk_source
CREATE TABLE "zmcc_milk_source" (
    "id" BIGSERIAL NOT NULL,
    "erp_code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "zmcc_id" BIGINT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" BIGINT NOT NULL,
    "updated_by" BIGINT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zmcc_milk_source_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "zmcc_milk_source_erp_code_key" UNIQUE ("erp_code"),
    CONSTRAINT "zmcc_milk_source_zmcc_id_name_key" UNIQUE ("zmcc_id", "name"),
    CONSTRAINT "zmcc_milk_source_id_zmcc_id_key" UNIQUE ("id", "zmcc_id"),
    CONSTRAINT "ck_zmcc_milk_source_erp_code_non_empty" CHECK (length(trim("erp_code")) > 0),
    CONSTRAINT "ck_zmcc_milk_source_name_non_empty" CHECK (length(trim("name")) > 0)
);

-- CreateTable: zmcc_shop
CREATE TABLE "zmcc_shop" (
    "id" BIGSERIAL NOT NULL,
    "shop_code" VARCHAR(50) NOT NULL,
    "shop_name" VARCHAR(150) NOT NULL,
    "owner_name" VARCHAR(150) NOT NULL,
    "phone_number" VARCHAR(30) NOT NULL,
    "cnic" VARCHAR(30) NOT NULL,
    "area_id" BIGINT NOT NULL,
    "route_id" BIGINT NOT NULL,
    "zmcc_id" BIGINT NOT NULL,
    "milk_source_id" BIGINT NOT NULL,
    "chiller_ownership_id" BIGINT NOT NULL,
    "latitude" DECIMAL(10, 7),
    "longitude" DECIMAL(10, 7),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" BIGINT NOT NULL,
    "updated_by" BIGINT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zmcc_shop_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "zmcc_shop_shop_code_key" UNIQUE ("shop_code"),
    CONSTRAINT "zmcc_shop_area_id_shop_name_key" UNIQUE ("area_id", "shop_name"),
    CONSTRAINT "ck_zmcc_shop_code_non_empty" CHECK (length(trim("shop_code")) > 0),
    CONSTRAINT "ck_zmcc_shop_name_non_empty" CHECK (length(trim("shop_name")) > 0),
    CONSTRAINT "ck_zmcc_shop_owner_name_non_empty" CHECK (length(trim("owner_name")) > 0),
    CONSTRAINT "ck_zmcc_shop_phone_format" CHECK ("phone_number" ~ '^(\+92-?|92-?|0)?3[0-9]{2}-?[0-9]{7}$'),
    CONSTRAINT "ck_zmcc_shop_cnic_format" CHECK ("cnic" ~ '^([0-9]{13}|[0-9]{5}-[0-9]{7}-[0-9])$'),
    CONSTRAINT "ck_zmcc_shop_gps_range" CHECK (("latitude" IS NULL AND "longitude" IS NULL) OR ("latitude" IS NOT NULL AND "longitude" IS NOT NULL AND "latitude" >= -90 AND "latitude" <= 90 AND "longitude" >= -180 AND "longitude" <= 180))
);

-- Indexes
CREATE INDEX "zmcc_route_zmcc_id_idx" ON "zmcc_route"("zmcc_id");
CREATE INDEX "zmcc_area_route_id_idx" ON "zmcc_area"("route_id");
CREATE INDEX "zmcc_area_zmcc_id_idx" ON "zmcc_area"("zmcc_id");
CREATE INDEX "zmcc_milk_source_zmcc_id_idx" ON "zmcc_milk_source"("zmcc_id");
CREATE INDEX "zmcc_shop_area_id_idx" ON "zmcc_shop"("area_id");
CREATE INDEX "zmcc_shop_route_id_idx" ON "zmcc_shop"("route_id");
CREATE INDEX "zmcc_shop_zmcc_id_idx" ON "zmcc_shop"("zmcc_id");
CREATE INDEX "zmcc_shop_milk_source_id_idx" ON "zmcc_shop"("milk_source_id");
CREATE INDEX "zmcc_shop_chiller_ownership_id_idx" ON "zmcc_shop"("chiller_ownership_id");

-- Foreign Keys: chiller_ownership
ALTER TABLE "chiller_ownership" ADD CONSTRAINT "chiller_ownership_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "chiller_ownership" ADD CONSTRAINT "chiller_ownership_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Foreign Keys: zmcc_route
ALTER TABLE "zmcc_route" ADD CONSTRAINT "zmcc_route_zmcc_id_fkey" FOREIGN KEY ("zmcc_id") REFERENCES "procurement_source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "zmcc_route" ADD CONSTRAINT "zmcc_route_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "zmcc_route" ADD CONSTRAINT "zmcc_route_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Foreign Keys: zmcc_area (Composite relation matching ZmccArea.route)
ALTER TABLE "zmcc_area" ADD CONSTRAINT "zmcc_area_route_id_zmcc_id_fkey" FOREIGN KEY ("route_id", "zmcc_id") REFERENCES "zmcc_route"("id", "zmcc_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "zmcc_area" ADD CONSTRAINT "zmcc_area_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "zmcc_area" ADD CONSTRAINT "zmcc_area_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Foreign Keys: zmcc_milk_source
ALTER TABLE "zmcc_milk_source" ADD CONSTRAINT "zmcc_milk_source_zmcc_id_fkey" FOREIGN KEY ("zmcc_id") REFERENCES "procurement_source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "zmcc_milk_source" ADD CONSTRAINT "zmcc_milk_source_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "zmcc_milk_source" ADD CONSTRAINT "zmcc_milk_source_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Foreign Keys: zmcc_shop (Composite relations matching ZmccShop.area and ZmccShop.milk_source)
ALTER TABLE "zmcc_shop" ADD CONSTRAINT "zmcc_shop_area_id_route_id_zmcc_id_fkey" FOREIGN KEY ("area_id", "route_id", "zmcc_id") REFERENCES "zmcc_area"("id", "route_id", "zmcc_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "zmcc_shop" ADD CONSTRAINT "zmcc_shop_milk_source_id_zmcc_id_fkey" FOREIGN KEY ("milk_source_id", "zmcc_id") REFERENCES "zmcc_milk_source"("id", "zmcc_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "zmcc_shop" ADD CONSTRAINT "zmcc_shop_chiller_ownership_id_fkey" FOREIGN KEY ("chiller_ownership_id") REFERENCES "chiller_ownership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "zmcc_shop" ADD CONSTRAINT "zmcc_shop_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "zmcc_shop" ADD CONSTRAINT "zmcc_shop_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
