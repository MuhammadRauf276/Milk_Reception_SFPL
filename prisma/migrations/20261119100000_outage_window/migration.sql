-- Outage windows: the Super Admin's decision to allow entries older than 3 days for some stations after the site
-- was down. New table only; no existing data changes.
CREATE TABLE IF NOT EXISTS "outage_window" (
  "id"             BIGSERIAL PRIMARY KEY,
  "starts_at"      TIMESTAMP(6) NOT NULL,
  "ends_at"        TIMESTAMP(6) NOT NULL,
  "all_stations"   BOOLEAN NOT NULL DEFAULT false,
  "plant_stations" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "zmcc_ids"       BIGINT[] NOT NULL DEFAULT ARRAY[]::BIGINT[],
  "reason"         TEXT NOT NULL,
  "catch_up_until" TIMESTAMP(6) NOT NULL,
  "closed_at"      TIMESTAMP(6),
  "closed_by"      BIGINT,
  "created_by"     BIGINT NOT NULL,
  "created_at"     TIMESTAMP(6) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  "updated_at"     TIMESTAMP(6) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  CONSTRAINT "outage_window_order" CHECK ("ends_at" > "starts_at" AND "catch_up_until" >= "ends_at")
);

CREATE INDEX IF NOT EXISTS "outage_window_catch_up_until_idx" ON "outage_window" ("catch_up_until");

-- Same updated_at trigger as every other table (UTC, because the column has no time zone).
DROP TRIGGER IF EXISTS trg_set_updated_at ON "outage_window";
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON "outage_window" FOR EACH ROW EXECUTE FUNCTION set_updated_at_utc();
