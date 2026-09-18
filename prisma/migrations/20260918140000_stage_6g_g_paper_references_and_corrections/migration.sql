-- CreateEnum
CREATE TYPE "PaperReferenceType" AS ENUM ('SHOP_RMR', 'RAW_MILK_TOKEN', 'RAW_MILK_DISPATCH_NOTE');

-- CreateEnum
CREATE TYPE "PaperPolicyMode" AS ENUM ('REQUIRED', 'OPTIONAL', 'DISABLED');

-- DropForeignKey
ALTER TABLE "zmcc_tank" DROP CONSTRAINT IF EXISTS "zmcc_tank_created_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "zmcc_tank" DROP CONSTRAINT IF EXISTS "zmcc_tank_updated_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "zmcc_tank" DROP CONSTRAINT IF EXISTS "zmcc_tank_zmcc_id_fkey";

-- DropForeignKey
ALTER TABLE "zmcc_tank_inventory_transaction" DROP CONSTRAINT IF EXISTS "zmcc_tank_inventory_transaction_performed_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "zmcc_tank_inventory_transaction" DROP CONSTRAINT IF EXISTS "zmcc_tank_inventory_transaction_tank_id_fkey";

-- DropForeignKey
ALTER TABLE "zmcc_tank_inventory_transaction" DROP CONSTRAINT IF EXISTS "zmcc_tank_inventory_transaction_tank_receipt_id_fkey";

-- DropForeignKey
ALTER TABLE "zmcc_tank_inventory_transaction" DROP CONSTRAINT IF EXISTS "zmcc_tank_inventory_transaction_zmcc_id_fkey";

-- DropForeignKey
ALTER TABLE "zmcc_tank_receipt" DROP CONSTRAINT IF EXISTS "zmcc_tank_receipt_lab_session_id_fkey";

-- DropForeignKey
ALTER TABLE "zmcc_tank_receipt" DROP CONSTRAINT IF EXISTS "zmcc_tank_receipt_last_corrected_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "zmcc_tank_receipt" DROP CONSTRAINT IF EXISTS "zmcc_tank_receipt_received_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "zmcc_tank_receipt" DROP CONSTRAINT IF EXISTS "zmcc_tank_receipt_tank_id_fkey";

-- DropForeignKey
ALTER TABLE "zmcc_tank_receipt" DROP CONSTRAINT IF EXISTS "zmcc_tank_receipt_zmcc_id_fkey";

-- DropIndex
DROP INDEX IF EXISTS "lab_test_rule_lab_test_id_is_active_idx";

-- DropIndex
DROP INDEX IF EXISTS "plant_final_dual_reconciliation_final_receipt_transacti_idx";

-- DropIndex
DROP INDEX IF EXISTS "plant_final_dual_reconciliation_visit_id_idx";

-- AlterTable
ALTER TABLE "lab_test_rule" ADD COLUMN     "testing_point" VARCHAR(50);

-- AlterTable
ALTER TABLE "milk_test_policy_assignment" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "mot_shop_collection" ADD COLUMN     "shop_rmr_number" VARCHAR(50);

-- AlterTable
ALTER TABLE "plant_lab_result" ADD COLUMN     "applied_rule_id" BIGINT,
ADD COLUMN     "applied_rule_version" INTEGER,
ADD COLUMN     "evaluation_status" VARCHAR(50);

-- AlterTable
ALTER TABLE "vehicle_visit" ADD COLUMN     "raw_milk_dispatch_note_number" VARCHAR(100);

-- AlterTable
ALTER TABLE "visit_portion" ADD COLUMN     "corrected_plant_decision" VARCHAR(255),
ADD COLUMN     "manager_requested_decision" VARCHAR(50),
ADD COLUMN     "manager_review_reason" TEXT,
ADD COLUMN     "manager_review_requested_at" TIMESTAMP(6),
ADD COLUMN     "manager_review_requested_by_user_id" BIGINT,
ADD COLUMN     "manager_review_status" VARCHAR(50) NOT NULL DEFAULT 'NONE',
ADD COLUMN     "manager_reviewed_at" TIMESTAMP(6),
ADD COLUMN     "manager_reviewed_by_user_id" BIGINT,
ADD COLUMN     "original_plant_decision" VARCHAR(255),
ADD COLUMN     "plant_corrected_at" TIMESTAMP(6),
ADD COLUMN     "plant_corrected_by" BIGINT,
ADD COLUMN     "plant_correction_reason" TEXT,
ADD COLUMN     "system_quality_outcome" VARCHAR(50);

-- AlterTable
ALTER TABLE "zmcc_lab_result" ADD COLUMN     "applied_rule_id" BIGINT,
ADD COLUMN     "applied_rule_version" INTEGER;

-- AlterTable
ALTER TABLE "zmcc_lab_session" ADD COLUMN     "corrected_decision" VARCHAR(50),
ADD COLUMN     "correction_reason" TEXT,
ADD COLUMN     "manager_requested_decision" VARCHAR(50),
ADD COLUMN     "manager_review_reason" TEXT,
ADD COLUMN     "manager_review_requested_at" TIMESTAMP(6),
ADD COLUMN     "manager_review_requested_by_user_id" BIGINT,
ADD COLUMN     "manager_review_status" VARCHAR(50) NOT NULL DEFAULT 'NONE',
ADD COLUMN     "manager_reviewed_at" TIMESTAMP(6),
ADD COLUMN     "manager_reviewed_by_user_id" BIGINT,
ADD COLUMN     "original_decision" VARCHAR(50),
ADD COLUMN     "system_quality_outcome" VARCHAR(50);

-- AlterTable
ALTER TABLE "zmcc_mot_arrival" ADD COLUMN     "raw_milk_token_number" VARCHAR(100),
ALTER COLUMN "route_milk_token" DROP NOT NULL;

-- AlterTable
ALTER TABLE "zmcc_tank" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "zmcc_tank_receipt" ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateTable
CREATE TABLE "paper_reference_policy" (
    "id" BIGSERIAL NOT NULL,
    "reference_type" "PaperReferenceType" NOT NULL,
    "policy_mode" "PaperPolicyMode" NOT NULL DEFAULT 'OPTIONAL',
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

-- RenameForeignKey
DO $$ BEGIN
    ALTER TABLE "plant_final_dual_reconciliation" RENAME CONSTRAINT "plant_final_dual_reconciliation_final_receipt_transaction_id_fk" TO "plant_final_dual_reconciliation_final_receipt_transaction__fkey";
EXCEPTION
    WHEN OTHERS THEN NULL;
END $$;

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

-- AddForeignKey
ALTER TABLE "zmcc_tank" ADD CONSTRAINT "zmcc_tank_zmcc_id_fkey" FOREIGN KEY ("zmcc_id") REFERENCES "procurement_source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zmcc_tank" ADD CONSTRAINT "zmcc_tank_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zmcc_tank" ADD CONSTRAINT "zmcc_tank_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zmcc_tank_receipt" ADD CONSTRAINT "zmcc_tank_receipt_lab_session_id_fkey" FOREIGN KEY ("lab_session_id") REFERENCES "zmcc_lab_session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zmcc_tank_receipt" ADD CONSTRAINT "zmcc_tank_receipt_zmcc_id_fkey" FOREIGN KEY ("zmcc_id") REFERENCES "procurement_source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zmcc_tank_receipt" ADD CONSTRAINT "zmcc_tank_receipt_tank_id_fkey" FOREIGN KEY ("tank_id") REFERENCES "zmcc_tank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zmcc_tank_receipt" ADD CONSTRAINT "zmcc_tank_receipt_received_by_user_id_fkey" FOREIGN KEY ("received_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zmcc_tank_receipt" ADD CONSTRAINT "zmcc_tank_receipt_last_corrected_by_user_id_fkey" FOREIGN KEY ("last_corrected_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zmcc_tank_inventory_transaction" ADD CONSTRAINT "zmcc_tank_inventory_transaction_tank_id_fkey" FOREIGN KEY ("tank_id") REFERENCES "zmcc_tank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zmcc_tank_inventory_transaction" ADD CONSTRAINT "zmcc_tank_inventory_transaction_zmcc_id_fkey" FOREIGN KEY ("zmcc_id") REFERENCES "procurement_source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zmcc_tank_inventory_transaction" ADD CONSTRAINT "zmcc_tank_inventory_transaction_tank_receipt_id_fkey" FOREIGN KEY ("tank_receipt_id") REFERENCES "zmcc_tank_receipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zmcc_tank_inventory_transaction" ADD CONSTRAINT "zmcc_tank_inventory_transaction_performed_by_user_id_fkey" FOREIGN KEY ("performed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX IF EXISTS "plant_final_dual_reconciliation_final_receipt_transaction_key" RENAME TO "plant_final_dual_reconciliation_final_receipt_transaction_i_key";

-- RenameIndex
ALTER INDEX IF EXISTS "zmcc_tank_inv_tx_tank_id_op_time_idx" RENAME TO "zmcc_tank_inventory_transaction_tank_id_operational_timesta_idx";

-- RenameIndex
ALTER INDEX IF EXISTS "zmcc_tank_inv_tx_zmcc_id_op_time_idx" RENAME TO "zmcc_tank_inventory_transaction_zmcc_id_operational_timesta_idx";

