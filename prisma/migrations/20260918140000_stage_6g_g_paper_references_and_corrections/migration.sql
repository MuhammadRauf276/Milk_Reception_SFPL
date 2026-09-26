-- CreateEnum
CREATE TYPE "PaperReferenceType" AS ENUM ('SHOP_RMR', 'RAW_MILK_TOKEN', 'RAW_MILK_DISPATCH_NOTE');

-- CreateEnum
CREATE TYPE "PaperPolicyMode" AS ENUM ('REQUIRED', 'OPTIONAL', 'DISABLED');

-- AlterTable
ALTER TABLE "lab_test_rule" ADD COLUMN "testing_point" VARCHAR(50);

-- AlterTable
ALTER TABLE "mot_shop_collection" ADD COLUMN "shop_rmr_number" VARCHAR(50);

-- AlterTable
ALTER TABLE "plant_lab_result" ADD COLUMN "applied_rule_id" BIGINT,
ADD COLUMN "applied_rule_version" INTEGER,
ADD COLUMN "evaluation_status" VARCHAR(50),
ADD COLUMN "evaluation_snapshot" JSONB;

-- AlterTable
ALTER TABLE "vehicle_visit" ADD COLUMN "raw_milk_dispatch_note_number" VARCHAR(100);

-- AlterTable
ALTER TABLE "visit_portion" ADD COLUMN "corrected_plant_decision" VARCHAR(255),
ADD COLUMN "manager_requested_decision" VARCHAR(50),
ADD COLUMN "manager_review_reason" TEXT,
ADD COLUMN "manager_review_requested_at" TIMESTAMP(6),
ADD COLUMN "manager_review_requested_by_user_id" BIGINT,
ADD COLUMN "manager_review_status" VARCHAR(50) NOT NULL DEFAULT 'NONE',
ADD COLUMN "manager_reviewed_at" TIMESTAMP(6),
ADD COLUMN "manager_reviewed_by_user_id" BIGINT,
ADD COLUMN "original_plant_decision" VARCHAR(255),
ADD COLUMN "plant_corrected_at" TIMESTAMP(6),
ADD COLUMN "plant_corrected_by" BIGINT,
ADD COLUMN "plant_correction_reason" TEXT,
ADD COLUMN "system_quality_outcome" VARCHAR(50),
ADD COLUMN "correction_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "manager_correction_count" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "zmcc_lab_result" ADD COLUMN "applied_rule_id" BIGINT,
ADD COLUMN "applied_rule_version" INTEGER,
ADD COLUMN "evaluation_snapshot" JSONB;

-- AlterTable
ALTER TABLE "zmcc_lab_session" ADD COLUMN "corrected_decision" VARCHAR(50),
ADD COLUMN "correction_reason" TEXT,
ADD COLUMN "manager_requested_decision" VARCHAR(50),
ADD COLUMN "manager_review_reason" TEXT,
ADD COLUMN "manager_review_requested_at" TIMESTAMP(6),
ADD COLUMN "manager_review_requested_by_user_id" BIGINT,
ADD COLUMN "manager_review_status" VARCHAR(50) NOT NULL DEFAULT 'NONE',
ADD COLUMN "manager_reviewed_at" TIMESTAMP(6),
ADD COLUMN "manager_reviewed_by_user_id" BIGINT,
ADD COLUMN "original_decision" VARCHAR(50),
ADD COLUMN "system_quality_outcome" VARCHAR(50);

-- AlterTable
ALTER TABLE "zmcc_mot_arrival" ADD COLUMN "raw_milk_token_number" VARCHAR(100),
ALTER COLUMN "route_milk_token" DROP NOT NULL;

-- CreateTable
CREATE TABLE "paper_reference_policy" (
    "id" BIGSERIAL NOT NULL,
    "reference_type" "PaperReferenceType" NOT NULL,
    "policy_mode" "PaperPolicyMode" NOT NULL DEFAULT 'REQUIRED',
    "allow_duplicates" BOOLEAN NOT NULL DEFAULT false,
    "duplicate_scope" VARCHAR(50) NOT NULL DEFAULT 'GLOBAL',
    "updated_by_user_id" BIGINT,
    "updated_at" TIMESTAMP(6) NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paper_reference_policy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "paper_reference_policy_reference_type_key" ON "paper_reference_policy"("reference_type");

-- CreateIndex
CREATE INDEX "lab_test_rule_lab_test_id_testing_point_rule_category_is_ac_idx" ON "lab_test_rule"("lab_test_id", "testing_point", "rule_category", "is_active");

-- CreateIndex
CREATE INDEX "lab_test_rule_effective_from_effective_to_idx" ON "lab_test_rule"("effective_from", "effective_to");

-- CreateIndex
CREATE INDEX "mot_shop_collection_shop_rmr_number_idx" ON "mot_shop_collection"("shop_rmr_number");

-- CreateIndex
CREATE INDEX "plant_lab_result_applied_rule_id_idx" ON "plant_lab_result"("applied_rule_id");

-- CreateIndex
CREATE INDEX "vehicle_visit_raw_milk_dispatch_note_number_idx" ON "vehicle_visit"("raw_milk_dispatch_note_number");

-- CreateIndex
CREATE INDEX "visit_portion_manager_review_status_idx" ON "visit_portion"("manager_review_status");

-- CreateIndex
CREATE INDEX "zmcc_lab_result_applied_rule_id_idx" ON "zmcc_lab_result"("applied_rule_id");

-- CreateIndex
CREATE INDEX "zmcc_lab_session_manager_review_status_idx" ON "zmcc_lab_session"("manager_review_status");

-- CreateIndex
CREATE INDEX "zmcc_mot_arrival_raw_milk_token_number_idx" ON "zmcc_mot_arrival"("raw_milk_token_number");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "lab_test_rule_lab_test_id_testing_point_rule_category_version_key" ON "lab_test_rule"("lab_test_id", "testing_point", "rule_category", "version");

-- AddForeignKey
ALTER TABLE "visit_portion" ADD CONSTRAINT "visit_portion_plant_corrected_by_fkey" FOREIGN KEY ("plant_corrected_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_portion" ADD CONSTRAINT "visit_portion_manager_reviewed_by_user_id_fkey" FOREIGN KEY ("manager_reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_portion" ADD CONSTRAINT "visit_portion_manager_review_requested_by_user_id_fkey" FOREIGN KEY ("manager_review_requested_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plant_lab_result" ADD CONSTRAINT "plant_lab_result_applied_rule_id_fkey" FOREIGN KEY ("applied_rule_id") REFERENCES "lab_test_rule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_reference_policy" ADD CONSTRAINT "paper_reference_policy_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zmcc_lab_session" ADD CONSTRAINT "zmcc_lab_session_manager_reviewed_by_user_id_fkey" FOREIGN KEY ("manager_reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zmcc_lab_session" ADD CONSTRAINT "zmcc_lab_session_manager_review_requested_by_user_id_fkey" FOREIGN KEY ("manager_review_requested_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zmcc_lab_result" ADD CONSTRAINT "zmcc_lab_result_applied_rule_id_fkey" FOREIGN KEY ("applied_rule_id") REFERENCES "lab_test_rule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddCheckConstraint
ALTER TABLE "visit_portion" ADD CONSTRAINT "visit_portion_manager_correction_count_check" CHECK (
  "manager_correction_count" >= 0 AND
  "manager_correction_count" <= 5 AND
  "manager_correction_count" <= "correction_count"
);

-- Seed initial REQUIRED paper reference policies
INSERT INTO "paper_reference_policy" ("reference_type", "policy_mode", "allow_duplicates", "duplicate_scope", "updated_at", "created_at")
VALUES
    ('SHOP_RMR', 'REQUIRED', false, 'GLOBAL', NOW(), NOW()),
    ('RAW_MILK_TOKEN', 'REQUIRED', false, 'GLOBAL', NOW(), NOW()),
    ('RAW_MILK_DISPATCH_NOTE', 'REQUIRED', false, 'GLOBAL', NOW(), NOW())
ON CONFLICT ("reference_type") DO NOTHING;
