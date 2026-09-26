ALTER TABLE "zmcc_lab_session"
  ADD COLUMN "attendant_recommendation" VARCHAR(50),
  ADD COLUMN "attendant_recommended_by_user_id" BIGINT,
  ADD COLUMN "attendant_recommended_at" TIMESTAMP(6),
  ADD COLUMN "final_decision" VARCHAR(50),
  ADD COLUMN "final_decided_by_user_id" BIGINT,
  ADD COLUMN "final_decided_at" TIMESTAMP(6),
  ADD COLUMN "final_decision_reason" TEXT;

ALTER TABLE "zmcc_lab_session" ADD CONSTRAINT "zmcc_lab_session_attendant_recommended_by_fkey" FOREIGN KEY ("attendant_recommended_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "zmcc_lab_session" ADD CONSTRAINT "zmcc_lab_session_final_decided_by_fkey" FOREIGN KEY ("final_decided_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "zmcc_lab_session_final_decision_idx" ON "zmcc_lab_session"("final_decision", "final_decided_at");
