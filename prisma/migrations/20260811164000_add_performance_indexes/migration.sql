-- CreateIndex
CREATE INDEX IF NOT EXISTS "vehicle_visit_current_status_created_at_idx" ON "vehicle_visit"("current_status", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "vehicle_visit_created_at_idx" ON "vehicle_visit"("created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "visit_portion_plant_decision_idx" ON "visit_portion"("plant_decision");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "dispatch_lab_result_portion_id_idx" ON "dispatch_lab_result"("portion_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "dispatch_lab_result_visit_id_idx" ON "dispatch_lab_result"("visit_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "plant_lab_result_portion_id_idx" ON "plant_lab_result"("portion_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "plant_lab_result_visit_id_idx" ON "plant_lab_result"("visit_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "unloading_log_silo_id_idx" ON "unloading_log"("silo_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "audit_log_table_name_record_id_idx" ON "audit_log"("table_name", "record_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "audit_log_created_at_idx" ON "audit_log"("created_at");
