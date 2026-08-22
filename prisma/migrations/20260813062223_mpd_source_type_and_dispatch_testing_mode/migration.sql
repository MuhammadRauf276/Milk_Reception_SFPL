-- AlterTable
ALTER TABLE "dispatch_info" ADD COLUMN     "dispatch_testing_mode" VARCHAR(50) DEFAULT 'FULL',
ADD COLUMN     "dispatch_testing_reason" TEXT,
ADD COLUMN     "dispatch_testing_remarks" TEXT;

-- AlterTable
ALTER TABLE "dispatch_lab_result" ADD COLUMN     "not_performed_reason" TEXT,
ADD COLUMN     "performance_status" VARCHAR(50) NOT NULL DEFAULT 'PERFORMED';

-- CreateIndex
CREATE INDEX "vehicle_visit_procurement_source_id_created_at_idx" ON "vehicle_visit"("procurement_source_id", "created_at");
