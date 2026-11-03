-- 1. Reporting reads: composite/ordering indexes on vehicle_visit for the operational_date filters that
--    reports use (system scope: date range; ZMCC scope: source + date range). Additive, no data change.
CREATE INDEX IF NOT EXISTS idx_vehicle_visit_source_opdate ON vehicle_visit (procurement_source_id, operational_date DESC);
CREATE INDEX IF NOT EXISTS idx_vehicle_visit_opdate ON vehicle_visit (operational_date);

-- 2. vw_dispatch_vs_plant_test: same columns and same values as before, rebuilt so a WHERE visit_id = ... filter
--    is pushed down to the lab-result tables (their visit_id indexes) instead of aggregating every lab result first.
DROP VIEW IF EXISTS vw_dispatch_vs_plant_test CASCADE;
CREATE VIEW vw_dispatch_vs_plant_test AS
SELECT
  k.visit_id,
  k.test_id,
  t.test_name,
  t.unit,
  t.display_order,
  d.dispatch_value,
  p.plant_value
FROM (
  SELECT visit_id, test_id FROM dispatch_lab_result WHERE performance_status = 'PERFORMED' AND numeric_value IS NOT NULL
  UNION
  SELECT visit_id, test_id FROM plant_lab_result WHERE performance_status = 'PERFORMED' AND numeric_value IS NOT NULL
) k
JOIN lab_test t ON t.id = k.test_id
LEFT JOIN LATERAL (
  SELECT AVG(r.numeric_value) AS dispatch_value
  FROM dispatch_lab_result r
  WHERE r.visit_id = k.visit_id AND r.test_id = k.test_id AND r.performance_status = 'PERFORMED' AND r.numeric_value IS NOT NULL
) d ON true
LEFT JOIN LATERAL (
  SELECT AVG(r.numeric_value) AS plant_value
  FROM plant_lab_result r
  WHERE r.visit_id = k.visit_id AND r.test_id = k.test_id AND r.performance_status = 'PERFORMED' AND r.numeric_value IS NOT NULL
) p ON true;
