-- Excel reports for senior management. Two plain views (nothing is stored, no refresh needed).

-- 1. One row per portion with everything the Inspect window shows: the vehicle report columns plus the source
--    (so ZMCC and Contractor can be chosen), the papers, the seals, every time stamp and the final reconciliation.
--    It is built on vw_vehicle_portion_report so the screen and the Excel file can never show different values.
--    A date filter on dispatched_at is pushed down into that view, and joins whose columns are not asked for
--    are dropped by the planner, so a count or a page reads no more than before.
DROP VIEW IF EXISTS vw_vehicle_export_report;
CREATE VIEW vw_vehicle_export_report AS
SELECT
  r.*,
  v.visit_number,
  v.reception_number,
  v.raw_milk_dispatch_note_number AS dispatch_note_number,
  v.driver_name,
  ps.id AS source_id,
  ps.code AS source_code,
  upper(ps.source_type) AS source_type,
  v.dispatch_person_decision,
  v.dispatch_system_outcome,
  v.approval_status,
  v.vehicle_dispatch_gross_liters AS dispatch_gross_liters,
  p.seal_number,
  p.plant_seal_number_entered AS plant_seal_number,
  p.seal_match,
  p.plant_rejection_reason,
  p.plant_decided_at,
  g.entry_timestamp AS gate_in_at,
  g.exit_timestamp AS gate_out_at,
  g.tanker_washed,
  wt.ticket_number AS weight_ticket_number,
  wt.gross_timestamp AS first_weight_at,
  wt.tare_timestamp AS second_weight_at,
  ul.silo_number,
  ul.pump_start_timestamp AS unloading_started_at,
  ul.pump_end_timestamp AS unloading_finished_at,
  fdr.received_gross_liters,
  fdr.gross_variance_liters,
  fdr.gross_variance_percent,
  fdr.at_13ts_variance_liters,
  fdr.at_13ts_variance_percent,
  fdr.reconciled_at
FROM vw_vehicle_portion_report r
JOIN vehicle_visit v ON v.id = r.visit_id
JOIN visit_portion p ON p.id = r.portion_id
LEFT JOIN procurement_source ps ON ps.id = v.procurement_source_id
LEFT JOIN gate_log g ON g.visit_id = v.id
LEFT JOIN weight_ticket wt ON wt.visit_id = v.id
LEFT JOIN unloading_log ul ON ul.portion_id = p.id
LEFT JOIN plant_final_dual_reconciliation fdr ON fdr.visit_id = v.id;

-- 2. One row per portion and test: the dispatch result beside the plant result, numbers, text results and pass/fail.
--    A portion_id filter is pushed through the GROUP BY and UNION ALL into the portion_id index of both result tables.
DROP VIEW IF EXISTS vw_portion_test_comparison;
CREATE VIEW vw_portion_test_comparison AS
SELECT
  u.visit_id,
  u.portion_id,
  u.test_id,
  t.test_name,
  t.unit,
  t.display_order,
  AVG(u.numeric_value) FILTER (WHERE u.side = 'D') AS dispatch_value,
  AVG(u.numeric_value) FILTER (WHERE u.side = 'P') AS plant_value,
  MAX(u.text_value) FILTER (WHERE u.side = 'D') AS dispatch_text,
  MAX(u.text_value) FILTER (WHERE u.side = 'P') AS plant_text,
  BOOL_AND(u.is_passed) FILTER (WHERE u.side = 'D') AS dispatch_passed,
  BOOL_AND(u.is_passed) FILTER (WHERE u.side = 'P') AS plant_passed
FROM (
  SELECT 'D'::text AS side, visit_id, portion_id, test_id, numeric_value, text_value, is_passed
  FROM dispatch_lab_result WHERE performance_status = 'PERFORMED'
  UNION ALL
  SELECT 'P'::text, visit_id, portion_id, test_id, numeric_value, text_value, is_passed
  FROM plant_lab_result WHERE performance_status = 'PERFORMED'
) u
JOIN lab_test t ON t.id = u.test_id
GROUP BY u.visit_id, u.portion_id, u.test_id, t.test_name, t.unit, t.display_order;
