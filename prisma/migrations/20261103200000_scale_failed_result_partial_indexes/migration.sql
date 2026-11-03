-- Command Center "tests failed today" reads failed lab results by created_at on each result table.
-- Partial indexes hold only the failed rows (a small share), so they are tiny and cost nothing on passing inserts.
CREATE INDEX IF NOT EXISTS idx_dispatch_lab_result_failed_created ON dispatch_lab_result (created_at) WHERE is_passed = false;
CREATE INDEX IF NOT EXISTS idx_plant_lab_result_failed_created ON plant_lab_result (created_at) WHERE is_passed = false;
CREATE INDEX IF NOT EXISTS idx_zmcc_lab_result_failed_created ON zmcc_lab_result (created_at) WHERE is_passed = false;

-- vw_dispatch_vs_plant_test, third shape: one grouped pass over both result tables (same columns, same values).
-- A visit_id filter on the view is pushed through the GROUP BY and UNION ALL into both visit_id indexes, and a request
-- for hundreds of visits no longer pays a per-row lookup (measured 110-143 ms -> 18 ms for 500 visits at 5 years x3).
DROP VIEW IF EXISTS vw_dispatch_vs_plant_test CASCADE;
CREATE VIEW vw_dispatch_vs_plant_test AS
SELECT
  u.visit_id,
  u.test_id,
  t.test_name,
  t.unit,
  t.display_order,
  AVG(u.numeric_value) FILTER (WHERE u.side = 'D') AS dispatch_value,
  AVG(u.numeric_value) FILTER (WHERE u.side = 'P') AS plant_value
FROM (
  SELECT 'D'::text AS side, visit_id, test_id, numeric_value
  FROM dispatch_lab_result WHERE performance_status = 'PERFORMED' AND numeric_value IS NOT NULL
  UNION ALL
  SELECT 'P'::text, visit_id, test_id, numeric_value
  FROM plant_lab_result WHERE performance_status = 'PERFORMED' AND numeric_value IS NOT NULL
) u
JOIN lab_test t ON t.id = u.test_id
GROUP BY u.visit_id, u.test_id, t.test_name, t.unit, t.display_order;
