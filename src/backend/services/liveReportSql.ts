/**
 * Live versions of the two reporting materialized views, with the same columns.
 * The stored views only change when someone refreshes them by hand, so reports read these instead.
 * Use after FROM. Each one needs no parameters.
 */
export const LIVE_PLANT_TRANSIT_SQL = `(
  SELECT
    v.id AS visit_id,
    v.visit_number,
    v.reception_number,
    v.vehicle_number,
    v.procurement_source_id AS zmcc_id,
    ps.code AS zmcc_code,
    ps.name AS zmcc_name,
    v.operational_date,
    v.current_status,
    v.vehicle_dispatch_gross_liters AS dispatch_gross_liters,
    v.vehicle_dispatch_fat AS dispatch_fat,
    v.vehicle_dispatch_lr AS dispatch_lr,
    v.vehicle_dispatch_snf AS dispatch_snf,
    v.vehicle_dispatch_at_13ts_liters AS dispatch_at_13ts_liters,
    fdr.sent_gross_liters,
    fdr.received_gross_liters,
    fdr.gross_variance_liters,
    fdr.gross_variance_percent,
    fdr.sent_at_13ts_liters,
    fdr.received_at_13ts_liters,
    fdr.at_13ts_variance_liters,
    fdr.at_13ts_variance_percent,
    fdr.reconciled_at,
    v.created_at
  FROM vehicle_visit v
  JOIN procurement_source ps ON ps.id = v.procurement_source_id
  LEFT JOIN plant_final_dual_reconciliation fdr ON fdr.visit_id = v.id
  -- Only tankers actually sent: drafts and requests waiting for approval have not left the ZMCC.
  WHERE v.current_status NOT IN ('DRAFT_DISPATCH', 'PENDING_APPROVAL', 'CANCELLED')
) AS live_plant_transit`;

export const LIVE_DAILY_PROCUREMENT_SQL = `(
  SELECT
    j.zmcc_id,
    z.code AS zmcc_code,
    z.name AS zmcc_name,
    j.operational_date::date AS operational_date,
    j.route_id,
    r.route_code,
    r.name AS route_name,
    COUNT(DISTINCT j.id)::int AS journey_count,
    COUNT(c.id)::int AS total_shop_collections,
    ROUND(COALESCE(SUM(c.gross_liters), 0)::numeric, 2) AS total_gross_liters,
    ROUND(COALESCE(SUM(c.at_13ts_liters), 0)::numeric, 2) AS total_at_13ts_liters,
    ROUND((SUM(c.gross_liters * c.fat) / NULLIF(SUM(c.gross_liters), 0))::numeric, 2) AS avg_fat_percentage,
    ROUND((SUM(c.gross_liters * c.lr) / NULLIF(SUM(c.gross_liters), 0))::numeric, 2) AS avg_lr_reading,
    ROUND((SUM(c.gross_liters * c.snf) / NULLIF(SUM(c.gross_liters), 0))::numeric, 2) AS avg_snf_percentage
  FROM mot_journey j
  JOIN procurement_source z ON z.id = j.zmcc_id
  JOIN zmcc_route r ON r.id = j.route_id
  JOIN mot_shop_collection c ON c.journey_id = j.id
  WHERE c.final_decision IS DISTINCT FROM 'REJECTED'
  GROUP BY j.zmcc_id, z.code, z.name, j.operational_date::date, j.route_id, r.route_code, r.name
) AS live_daily_procurement`;
