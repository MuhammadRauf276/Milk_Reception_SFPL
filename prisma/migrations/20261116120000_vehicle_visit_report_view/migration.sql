-- Vehicle report, one row per vehicle (a plain view, nothing stored).
-- A vehicle can carry several portions (compartments, each with its own seal and quantity), and the plant can add a
-- portion for its own testing. The report shows the vehicle once: dispatch quality against plant quality, quantities,
-- variance, weights and gate times. The portions stay in Inspect and in the Portions sheet of the Excel file.
--
-- Dispatch quality: the vehicle values saved at dispatch, or the average of the dispatch results of its portions.
-- Plant quality: the composite saved at final receipt, or the average of the plant results until then.
-- Built on the first portion's row of vw_vehicle_export_report, so the date filter keeps using the dispatch index.
DROP VIEW IF EXISTS vw_vehicle_visit_report;
CREATE VIEW vw_vehicle_visit_report AS
SELECT
  r.visit_id,
  r.visit_number,
  r.vehicle_number,
  r.token_number,
  r.source_id,
  r.source_name,
  r.source_code,
  r.source_type,
  r.dispatched_at,
  r.dispatch_date_text,
  r.stage,
  CASE
    WHEN pc.total = 0 OR pc.pending > 0 THEN 'PENDING'
    WHEN pc.accepted = pc.total THEN 'ACCEPTED'
    WHEN pc.rejected = pc.total THEN 'REJECTED'
    ELSE 'PARTLY ACCEPTED'
  END AS decision,
  pc.total AS portions,
  pc.plant_added AS plant_added_portions,
  pc.accepted AS accepted_portions,
  pc.rejected AS rejected_portions,
  r.driver_name,
  r.dispatch_note_number,
  r.reception_number,
  r.dispatch_person_decision,
  r.dispatch_system_outcome,
  r.approval_status,
  r.tanker_washed,
  v.vehicle_dispatch_quantity_value AS dispatch_quantity_value,
  lower(v.vehicle_dispatch_quantity_unit::text) AS dispatch_quantity_unit,
  dq.fat AS dispatch_fat,
  dq.lr AS dispatch_lr,
  COALESCE(v.vehicle_dispatch_snf, round(dq.lr / 4 + 0.22 * dq.fat + 0.72, 3)) AS dispatch_snf,
  COALESCE(v.vehicle_dispatch_ts, dq.fat + round(dq.lr / 4 + 0.22 * dq.fat + 0.72, 3)) AS dispatch_ts,
  pq.fat AS plant_fat,
  pq.lr AS plant_lr,
  COALESCE(ftx.plant_snf, round(pq.lr / 4 + 0.22 * pq.fat + 0.72, 3)) AS plant_snf,
  COALESCE(ftx.plant_ts, pq.fat + round(pq.lr / 4 + 0.22 * pq.fat + 0.72, 3)) AS plant_ts,
  r.dispatch_gross_liters,
  r.received_gross_liters,
  r.gross_variance_liters,
  r.gross_variance_percent,
  r.dispatch_at_13ts_liters,
  r.received_at_13ts_liters,
  r.at_13ts_variance_liters,
  r.at_13ts_variance_percent,
  r.weight_ticket_number,
  r.first_weight_kg AS gross_weight_kg,
  r.second_weight_kg AS tare_weight_kg,
  r.net_weight_kg,
  r.gate_in_at,
  r.first_weight_at,
  r.second_weight_at,
  r.gate_out_at,
  r.reconciled_at
FROM vw_vehicle_export_report r
JOIN vehicle_visit v ON v.id = r.visit_id
LEFT JOIN plant_final_dual_reconciliation fdr ON fdr.visit_id = r.visit_id
LEFT JOIN silo_inventory_transaction ftx ON ftx.id = fdr.final_receipt_transaction_id
LEFT JOIN LATERAL (
  SELECT
    count(*)::int AS total,
    count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM dispatch_info d WHERE d.portion_id = pp.id))::int AS plant_added,
    count(*) FILTER (WHERE upper(COALESCE(pp.plant_decision, '')) = 'ACCEPTED')::int AS accepted,
    count(*) FILTER (WHERE upper(COALESCE(pp.plant_decision, '')) = 'REJECTED')::int AS rejected,
    count(*) FILTER (WHERE upper(COALESCE(pp.plant_decision, 'PENDING')) NOT IN ('ACCEPTED', 'REJECTED'))::int AS pending
  FROM visit_portion pp
  WHERE pp.visit_id = r.visit_id
) pc ON true
LEFT JOIN LATERAL (
  SELECT
    COALESCE(v.vehicle_dispatch_fat, round(avg(x.numeric_value) FILTER (
      WHERE t.system_role = 'FAT' OR (t.system_role IS NULL AND upper(trim(t.test_code)) = 'LT-000026')
    ), 3)) AS fat,
    COALESCE(v.vehicle_dispatch_lr, round(avg(x.numeric_value) FILTER (
      WHERE t.system_role = 'LR' OR (t.system_role IS NULL AND upper(trim(t.test_code)) = 'LT-000008')
    ), 3)) AS lr
  FROM dispatch_lab_result x
  JOIN lab_test t ON t.id = x.test_id
  WHERE x.visit_id = r.visit_id AND x.performance_status = 'PERFORMED' AND x.numeric_value IS NOT NULL
) dq ON true
LEFT JOIN LATERAL (
  SELECT
    COALESCE(ftx.plant_composite_fat, round(avg(x.numeric_value) FILTER (
      WHERE t.system_role = 'FAT' OR (t.system_role IS NULL AND upper(trim(t.test_code)) = 'LT-000026')
    ), 3)) AS fat,
    COALESCE(ftx.plant_composite_lr, round(avg(x.numeric_value) FILTER (
      WHERE t.system_role = 'LR' OR (t.system_role IS NULL AND upper(trim(t.test_code)) = 'LT-000008')
    ), 3)) AS lr
  FROM plant_lab_result x
  JOIN lab_test t ON t.id = x.test_id
  WHERE x.visit_id = r.visit_id AND x.performance_status = 'PERFORMED' AND x.numeric_value IS NOT NULL
) pq ON true
WHERE r.is_first_portion;
