ALTER TABLE "visit_portion"
  ADD COLUMN "completion_client_event_id" VARCHAR(255);

CREATE UNIQUE INDEX "visit_portion_completion_client_event_id_key"
  ON "visit_portion"("completion_client_event_id")
  WHERE "completion_client_event_id" IS NOT NULL;
