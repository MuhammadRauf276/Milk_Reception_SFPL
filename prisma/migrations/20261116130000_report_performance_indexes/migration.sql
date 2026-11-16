-- Indexes for the report and Command Center queries (nothing stored; indexes only).
-- Tank receipts by time across all ZMCCs (Command Center "received today", loss reports, HC analytics).
CREATE INDEX IF NOT EXISTS "zmcc_tank_receipt_received_at_idx" ON "zmcc_tank_receipt" ("received_at");
-- Plant decisions made today (Command Center quality funnel).
CREATE INDEX IF NOT EXISTS "visit_portion_plant_decided_at_idx" ON "visit_portion" ("plant_decided_at");
-- ZMCC lab decisions made today.
CREATE INDEX IF NOT EXISTS "zmcc_lab_session_status_completed_at_idx" ON "zmcc_lab_session" ("status", "completed_at");
-- Latest GPS fix per journey.
CREATE INDEX IF NOT EXISTS "mot_journey_location_journey_id_device_recorded_at_idx" ON "mot_journey_location" ("journey_id", "device_recorded_at" DESC);
