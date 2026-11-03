-- Senior management "Dispatch vs Plant" report: live read views (plain views, no refresh needed).

-- 1. One row per ZMCC tanker: what was sent, what the plant received (litres, weight, 13 TS, quality) and the variance.
DROP VIEW IF EXISTS vw_dispatch_vs_plant_visit CASCADE;
CREATE VIEW vw_dispatch_vs_plant_visit AS
SELECT
  v.id AS visit_id,
  v.visit_number,
  v.vehicle_number,
  v.procurement_source_id AS zmcc_id,
  ps.code AS zmcc_code,
  ps.name AS zmcc_name,
  v.operational_date,
  v.current_status,
  (fdr.id IS NOT NULL) AS is_received,
  v.vehicle_dispatch_gross_liters AS dispatch_gross_liters,
  v.vehicle_dispatch_lr AS dispatch_lr,
  v.vehicle_dispatch_fat AS dispatch_fat,
  v.vehicle_dispatch_snf AS dispatch_snf,
  v.vehicle_dispatch_ts AS dispatch_ts,
  v.vehicle_dispatch_at_13ts_liters AS dispatch_at_13ts_liters,
  tx.quantity_kg AS plant_net_kg,
  fdr.received_gross_liters AS plant_gross_liters,
  tx.plant_composite_lr AS plant_lr,
  tx.plant_composite_fat AS plant_fat,
  tx.plant_snf AS plant_snf,
  tx.plant_ts AS plant_ts,
  fdr.received_at_13ts_liters AS plant_at_13ts_liters,
  fdr.gross_variance_liters,
  fdr.gross_variance_percent,
  fdr.at_13ts_variance_liters,
  fdr.at_13ts_variance_percent,
  fdr.reconciled_at
FROM vehicle_visit v
JOIN procurement_source ps ON ps.id = v.procurement_source_id AND ps.source_type = 'ZMCC'
LEFT JOIN plant_final_dual_reconciliation fdr ON fdr.visit_id = v.id
LEFT JOIN silo_inventory_transaction tx ON tx.id = fdr.final_receipt_transaction_id
WHERE v.vehicle_dispatch_gross_liters IS NOT NULL;

-- 2. One row per tanker and test: average performed numeric result at dispatch vs at the plant.
DROP VIEW IF EXISTS vw_dispatch_vs_plant_test CASCADE;
CREATE VIEW vw_dispatch_vs_plant_test AS
WITH d AS (
  SELECT visit_id, test_id, AVG(numeric_value) AS dispatch_value
  FROM dispatch_lab_result
  WHERE performance_status = 'PERFORMED' AND numeric_value IS NOT NULL
  GROUP BY visit_id, test_id
), p AS (
  SELECT visit_id, test_id, AVG(numeric_value) AS plant_value
  FROM plant_lab_result
  WHERE performance_status = 'PERFORMED' AND numeric_value IS NOT NULL
  GROUP BY visit_id, test_id
)
SELECT
  COALESCE(d.visit_id, p.visit_id) AS visit_id,
  COALESCE(d.test_id, p.test_id) AS test_id,
  t.test_name,
  t.unit,
  t.display_order,
  d.dispatch_value,
  p.plant_value
FROM d
FULL OUTER JOIN p ON p.visit_id = d.visit_id AND p.test_id = d.test_id
JOIN lab_test t ON t.id = COALESCE(d.test_id, p.test_id);
