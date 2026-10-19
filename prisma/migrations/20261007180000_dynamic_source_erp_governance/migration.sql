-- DropForeignKey
ALTER TABLE "zmcc_milk_source" DROP CONSTRAINT IF EXISTS "zmcc_milk_source_zmcc_id_fkey";

-- DropForeignKey
ALTER TABLE "zmcc_shop" DROP CONSTRAINT IF EXISTS "zmcc_shop_milk_source_id_zmcc_id_fkey";

-- DropIndex
DROP INDEX IF EXISTS "zmcc_milk_source_id_zmcc_id_key";

-- DropIndex
DROP INDEX IF EXISTS "zmcc_milk_source_zmcc_id_name_key";

-- AlterTable
ALTER TABLE "mot_shop_collection" ADD COLUMN IF NOT EXISTS "milk_source_code_snapshot" VARCHAR(50),
ADD COLUMN IF NOT EXISTS "milk_source_id" BIGINT,
ADD COLUMN IF NOT EXISTS "milk_source_name_snapshot" VARCHAR(150);

-- AlterTable
ALTER TABLE "procurement_source" ADD COLUMN IF NOT EXISTS "erp_code" VARCHAR(50);

-- AlterTable
ALTER TABLE "zmcc_local_supplier_arrival" ADD COLUMN IF NOT EXISTS "milk_source_code_snapshot" VARCHAR(50),
ADD COLUMN IF NOT EXISTS "milk_source_id" BIGINT,
ADD COLUMN IF NOT EXISTS "milk_source_name_snapshot" VARCHAR(150);

-- AlterTable
ALTER TABLE "zmcc_milk_source" ALTER COLUMN "zmcc_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "zmcc_shop" ALTER COLUMN "milk_source_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE IF NOT EXISTS "milk_source_zmcc_visibility" (
    "id" BIGSERIAL NOT NULL,
    "milk_source_id" BIGINT NOT NULL,
    "zmcc_id" BIGINT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "milk_source_zmcc_visibility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "erp_code_request" (
    "id" BIGSERIAL NOT NULL,
    "requested_by_id" BIGINT NOT NULL,
    "zmcc_id" BIGINT NOT NULL,
    "proposed_name" VARCHAR(150) NOT NULL,
    "proposed_code" VARCHAR(50),
    "request_context" VARCHAR(50),
    "notes" TEXT,
    "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    "reviewed_by_id" BIGINT,
    "reviewed_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erp_code_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "milk_source_zmcc_visibility_zmcc_id_is_active_idx" ON "milk_source_zmcc_visibility"("zmcc_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "milk_source_zmcc_visibility_milk_source_id_zmcc_id_key" ON "milk_source_zmcc_visibility"("milk_source_id", "zmcc_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "erp_code_request_zmcc_id_status_idx" ON "erp_code_request"("zmcc_id", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "erp_code_request_status_idx" ON "erp_code_request"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "mot_shop_collection_milk_source_id_idx" ON "mot_shop_collection"("milk_source_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "zmcc_local_supplier_arrival_milk_source_id_idx" ON "zmcc_local_supplier_arrival"("milk_source_id");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'zmcc_milk_source_zmcc_id_fkey'
    ) THEN
        ALTER TABLE "zmcc_milk_source" ADD CONSTRAINT "zmcc_milk_source_zmcc_id_fkey" FOREIGN KEY ("zmcc_id") REFERENCES "procurement_source"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'zmcc_shop_milk_source_id_fkey'
    ) THEN
        ALTER TABLE "zmcc_shop" ADD CONSTRAINT "zmcc_shop_milk_source_id_fkey" FOREIGN KEY ("milk_source_id") REFERENCES "zmcc_milk_source"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'mot_shop_collection_milk_source_id_fkey'
    ) THEN
        ALTER TABLE "mot_shop_collection" ADD CONSTRAINT "mot_shop_collection_milk_source_id_fkey" FOREIGN KEY ("milk_source_id") REFERENCES "zmcc_milk_source"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'zmcc_local_supplier_arrival_milk_source_id_fkey'
    ) THEN
        ALTER TABLE "zmcc_local_supplier_arrival" ADD CONSTRAINT "zmcc_local_supplier_arrival_milk_source_id_fkey" FOREIGN KEY ("milk_source_id") REFERENCES "zmcc_milk_source"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'milk_source_zmcc_visibility_milk_source_id_fkey'
    ) THEN
        ALTER TABLE "milk_source_zmcc_visibility" ADD CONSTRAINT "milk_source_zmcc_visibility_milk_source_id_fkey" FOREIGN KEY ("milk_source_id") REFERENCES "zmcc_milk_source"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'milk_source_zmcc_visibility_zmcc_id_fkey'
    ) THEN
        ALTER TABLE "milk_source_zmcc_visibility" ADD CONSTRAINT "milk_source_zmcc_visibility_zmcc_id_fkey" FOREIGN KEY ("zmcc_id") REFERENCES "procurement_source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'erp_code_request_requested_by_id_fkey'
    ) THEN
        ALTER TABLE "erp_code_request" ADD CONSTRAINT "erp_code_request_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'erp_code_request_reviewed_by_id_fkey'
    ) THEN
        ALTER TABLE "erp_code_request" ADD CONSTRAINT "erp_code_request_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'erp_code_request_zmcc_id_fkey'
    ) THEN
        ALTER TABLE "erp_code_request" ADD CONSTRAINT "erp_code_request_zmcc_id_fkey" FOREIGN KEY ("zmcc_id") REFERENCES "procurement_source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;
