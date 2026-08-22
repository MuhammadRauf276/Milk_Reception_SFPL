-- AlterTable
ALTER TABLE "plant_lab_result" ADD COLUMN     "not_performed_reason" TEXT,
ADD COLUMN     "performance_status" VARCHAR(50) NOT NULL DEFAULT 'PERFORMED';
