-- An area is a place (village / locality) inside a ZMCC, no longer part of one route. A shop stays in one area
-- and keeps its home route (zmcc_shop.route_id) plus any extra routes (zmcc_route_shop). Which routes pass
-- through an area is read live from its shops' routes, not stored.

-- 1. Areas with the same name in one ZMCC are the same place: merge them into the oldest one.
DO $$
DECLARE
  clash text;
BEGIN
  -- Two shops with the same name in two same-name areas would collide after the merge: stop and name them.
  SELECT string_agg(format('%s / %s', a.name, s.shop_name), '; ')
    INTO clash
  FROM zmcc_shop s JOIN zmcc_area a ON a.id = s.area_id
  GROUP BY a.zmcc_id, lower(btrim(a.name)), lower(btrim(s.shop_name))
  HAVING COUNT(DISTINCT s.area_id) > 1
  LIMIT 1;
  IF clash IS NOT NULL THEN
    RAISE EXCEPTION 'Rename one of these shops before moving areas to the ZMCC (same shop name in same-name areas): %', clash;
  END IF;
END
$$;

DROP TABLE IF EXISTS area_merge;
CREATE TEMP TABLE area_merge AS
SELECT a.id AS old_id, k.keep_id
FROM zmcc_area a
JOIN (
  SELECT zmcc_id, lower(btrim(name)) AS key, MIN(id) AS keep_id
  FROM zmcc_area GROUP BY 1, 2 HAVING COUNT(*) > 1
) k ON k.zmcc_id = a.zmcc_id AND k.key = lower(btrim(a.name))
WHERE a.id <> k.keep_id;

INSERT INTO audit_log (table_name, record_id, action, old_values, new_values, created_at, actor_role, performed_as_role)
SELECT 'zmcc_area', m.old_id, 'AREA_MERGED_INTO_SAME_NAME',
       jsonb_build_object('area_id', m.old_id, 'area_code', a.area_code, 'name', a.name, 'route_id', a.route_id),
       jsonb_build_object('kept_area_id', m.keep_id),
       now() AT TIME ZONE 'UTC', 'SUPER_ADMIN', 'SUPER_ADMIN'
FROM area_merge m JOIN zmcc_area a ON a.id = m.old_id;

-- 2. The shop no longer has to share its area's route.
ALTER TABLE "zmcc_shop" DROP CONSTRAINT IF EXISTS "zmcc_shop_area_id_route_id_zmcc_id_fkey";

UPDATE zmcc_shop s SET area_id = m.keep_id FROM area_merge m WHERE s.area_id = m.old_id;
UPDATE zmcc_area k SET is_active = true
WHERE k.id IN (SELECT m.keep_id FROM area_merge m JOIN zmcc_area a ON a.id = m.old_id WHERE a.is_active);
DELETE FROM zmcc_area WHERE id IN (SELECT old_id FROM area_merge);
DROP TABLE area_merge;

-- 3. The area belongs to its ZMCC; names are unique inside a ZMCC.
ALTER TABLE "zmcc_area" DROP CONSTRAINT IF EXISTS "zmcc_area_route_id_zmcc_id_fkey";
ALTER TABLE "zmcc_area" DROP CONSTRAINT IF EXISTS "zmcc_area_route_id_name_key";
ALTER TABLE "zmcc_area" DROP CONSTRAINT IF EXISTS "zmcc_area_id_route_id_zmcc_id_key";
DROP INDEX IF EXISTS "zmcc_area_route_id_idx";
ALTER TABLE "zmcc_area" DROP COLUMN "route_id";

CREATE UNIQUE INDEX "zmcc_area_zmcc_id_name_key" ON "zmcc_area"("zmcc_id", "name");
CREATE UNIQUE INDEX "zmcc_area_id_zmcc_id_key" ON "zmcc_area"("id", "zmcc_id");
ALTER TABLE "zmcc_area" ADD CONSTRAINT "zmcc_area_zmcc_id_fkey"
  FOREIGN KEY ("zmcc_id") REFERENCES "procurement_source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. A shop's area and its home route are both inside the shop's own ZMCC.
ALTER TABLE "zmcc_shop" ADD CONSTRAINT "zmcc_shop_area_id_zmcc_id_fkey"
  FOREIGN KEY ("area_id", "zmcc_id") REFERENCES "zmcc_area"("id", "zmcc_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "zmcc_shop" ADD CONSTRAINT "zmcc_shop_route_id_zmcc_id_fkey"
  FOREIGN KEY ("route_id", "zmcc_id") REFERENCES "zmcc_route"("id", "zmcc_id") ON DELETE RESTRICT ON UPDATE CASCADE;
