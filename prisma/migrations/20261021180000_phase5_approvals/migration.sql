-- Phase 5 workflow alignment (WORKFLOW_ALIGNMENT_PLAN.md §2.2, §4.4, §8, §14)
-- Universal Approval Matrix, Segregation of Duties & Adaptive Approval Inbox

-- AlterTable
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "self_approved" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "audit_log_self_approved_idx" ON "audit_log"("self_approved");
