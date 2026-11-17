-- 1. "updated_at" is always set by the database on every UPDATE, also for raw SQL updates that bypass Prisma's
--    @updatedAt. Only a timestamp is written; no business rule lives in these triggers.
--    The app stores UTC in "timestamp without time zone" columns while the database clock is Asia/Karachi, so
--    those columns get now() in UTC; "timestamp with time zone" columns get now() as is.
CREATE OR REPLACE FUNCTION set_updated_at_utc() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := (now() AT TIME ZONE 'UTC');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION set_updated_at_tz() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT table_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'updated_at'
      AND table_name IN (SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE')
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_set_updated_at ON %I', c.table_name);
    EXECUTE format(
      'CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION %I()',
      c.table_name,
      CASE WHEN c.data_type = 'timestamp with time zone' THEN 'set_updated_at_tz' ELSE 'set_updated_at_utc' END
    );
  END LOOP;
END;
$$;

-- 2. The two materialized views stored copies of totals and were never read by the app (reports read the live
--    queries); they were only refreshed by a button. Dropping them removes no source data.
DROP MATERIALIZED VIEW IF EXISTS mv_daily_procurement_rollup;
DROP MATERIALIZED VIEW IF EXISTS mv_plant_transit_reconciliation;
