-- Every stored time becomes "timestamp with time zone". The values were UTC without a zone, so each one is read as
-- UTC and keeps the same instant; database tools (pgAdmin, psql) then show Pakistan time, because the database time
-- zone is Asia/Karachi. The app's own connection runs in UTC (src/backend/core/db.ts), which the Prisma driver needs.
-- One transaction: if any step fails, nothing changes.
BEGIN;

-- 1. Stop if times look like Pakistan time saved where UTC belongs (5 hours ahead): converting them would move them.
--    Columns that hold planned future times are skipped.
DO $$
DECLARE
  c record;
  n bigint;
  found text := '';
BEGIN
  FOR c IN
    SELECT col.table_name, col.column_name
    FROM information_schema.columns col
    JOIN information_schema.tables t ON t.table_schema = col.table_schema AND t.table_name = col.table_name
    WHERE col.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      AND col.data_type = 'timestamp without time zone'
      AND col.column_name NOT IN ('catch_up_until', 'expires_at', 'effective_from', 'effective_to')
  LOOP
    EXECUTE format('SELECT COUNT(*) FROM %I WHERE %I > (now() AT TIME ZONE ''UTC'') + interval ''1 hour''', c.table_name, c.column_name)
      INTO n;
    IF n > 0 THEN
      found := found || format('%s.%s (%s rows); ', c.table_name, c.column_name, n);
    END IF;
  END LOOP;
  IF found <> '' THEN
    RAISE EXCEPTION 'Times more than 1 hour ahead of UTC found, nothing changed. Check these first: %', found;
  END IF;
END
$$;

-- 2. Keep the views' definitions and drop them (a column type cannot change under a view). The one expression that
--    turned a UTC value into Pakistan time in two steps becomes a single step for the new column type.
CREATE TEMP TABLE _tz_views ON COMMIT DROP AS
SELECT c.oid, c.relname, pg_get_viewdef(c.oid, true) AS def, false AS done
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'v';

UPDATE _tz_views
SET def = regexp_replace(
  def,
  '\(\(([a-z_]+(\.[a-z_]+)?) AT TIME ZONE ''UTC''::text\) AT TIME ZONE ''Asia/Karachi''::text\)',
  '(\1 AT TIME ZONE ''Asia/Karachi''::text)',
  'g'
);

DO $$
DECLARE
  v record;
BEGIN
  IF EXISTS (SELECT 1 FROM _tz_views WHERE def ILIKE '%AT TIME ZONE ''UTC''%') THEN
    RAISE EXCEPTION 'A view still converts from UTC in a way this migration does not know: %',
      (SELECT string_agg(relname, ', ') FROM _tz_views WHERE def ILIKE '%AT TIME ZONE ''UTC''%');
  END IF;
  FOR v IN SELECT relname FROM _tz_views LOOP
    EXECUTE format('DROP VIEW IF EXISTS %I CASCADE', v.relname);
  END LOOP;
END
$$;

-- 3. Convert every time column, one rewrite per table. Defaults written as "now() in UTC" become plain now().
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT col.table_name,
           string_agg(
             format('ALTER COLUMN %I TYPE timestamptz(%s) USING %I AT TIME ZONE ''UTC''',
                    col.column_name, COALESCE(col.datetime_precision, 6), col.column_name),
             ', ' ORDER BY col.ordinal_position
           ) AS alters,
           string_agg(format('ALTER COLUMN %I DROP DEFAULT', col.column_name), ', ')
             FILTER (WHERE col.column_default ILIKE '%time zone%') AS drop_defaults,
           string_agg(format('ALTER COLUMN %I SET DEFAULT now()', col.column_name), ', ')
             FILTER (WHERE col.column_default ILIKE '%time zone%') AS set_defaults
    FROM information_schema.columns col
    JOIN information_schema.tables tb ON tb.table_schema = col.table_schema AND tb.table_name = col.table_name
    WHERE col.table_schema = 'public' AND tb.table_type = 'BASE TABLE'
      AND col.data_type = 'timestamp without time zone'
      AND col.table_name <> '_prisma_migrations'
    GROUP BY col.table_name
  LOOP
    IF t.drop_defaults IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I %s', t.table_name, t.drop_defaults);
    END IF;
    EXECUTE format('ALTER TABLE %I %s', t.table_name, t.alters);
    IF t.set_defaults IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I %s', t.table_name, t.set_defaults);
    END IF;
  END LOOP;
END
$$;

-- 4. updated_at is now simply now() everywhere; the UTC-only trigger function is no longer needed.
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
    SELECT col.table_name
    FROM information_schema.columns col
    JOIN information_schema.tables t ON t.table_schema = col.table_schema AND t.table_name = col.table_name
    WHERE col.table_schema = 'public' AND col.column_name = 'updated_at' AND t.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_set_updated_at ON %I', c.table_name);
    EXECUTE format('CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at_tz()', c.table_name);
  END LOOP;
END
$$;

DROP FUNCTION IF EXISTS set_updated_at_utc();

-- 5. Rebuild the views (a view built on another view waits for it).
DO $$
DECLARE
  v record;
  waiting int;
  progress boolean;
BEGIN
  LOOP
    waiting := 0;
    progress := false;
    FOR v IN SELECT oid, relname, def FROM _tz_views WHERE NOT done ORDER BY oid LOOP
      BEGIN
        EXECUTE format('CREATE VIEW %I AS %s', v.relname, v.def);
        UPDATE _tz_views SET done = true WHERE oid = v.oid;
        progress := true;
      EXCEPTION WHEN undefined_table THEN
        waiting := waiting + 1;
      END;
    END LOOP;
    EXIT WHEN waiting = 0;
    IF NOT progress THEN
      RAISE EXCEPTION 'Could not rebuild views: %', (SELECT string_agg(relname, ', ') FROM _tz_views WHERE NOT done);
    END IF;
  END LOOP;
END
$$;

-- 6. Nothing left without a time zone.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns col
    JOIN information_schema.tables t ON t.table_schema = col.table_schema AND t.table_name = col.table_name
    WHERE col.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND col.data_type = 'timestamp without time zone'
  ) THEN
    RAISE EXCEPTION 'Some time columns were not converted.';
  END IF;
END
$$;

COMMIT;
