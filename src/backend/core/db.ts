import { Pool } from 'pg';
import { PrismaClient } from '@prisma/client';
import { MilkProcessLog, DataAuditLog, User, ProcessStatus } from './types';
import { computeRuntimeMetrics } from '../services/dairyCalculations';

export const prisma = new PrismaClient();

// Initialize PostgreSQL Connection Pool using env DATABASE_URL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:rauf@localhost:5432/milk_reception_db'
});

// Helper function to map PostgreSQL ERD relational query results to MilkProcessLog
function mapPgRowToLog(row: any): MilkProcessLog {
  const opDate = row.operational_date ? new Date(row.operational_date) : new Date(row.created_at || Date.now());
  const dateStr = opDate.toISOString().split('T')[0];
  const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const monthsOfYear = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const grossKg = row.declared_quantity_kg ? Number(row.declared_quantity_kg) : 12000;
  const grossLiters = Math.round(grossKg / 1.03);

  const dispatchFat = row.dispatch_fat ? Number(row.dispatch_fat) : 3.8;
  const dispatchLr = row.dispatch_lr ? Number(row.dispatch_lr) : 28.0;
  const samplingFat = row.sampling_fat ? Number(row.sampling_fat) : dispatchFat;
  const samplingLr = row.sampling_lr ? Number(row.sampling_lr) : dispatchLr;

  const firstWeightKg = row.gross_weight_kg ? Number(row.gross_weight_kg) : null;
  const secondWeightKg = row.tare_weight_kg ? Number(row.tare_weight_kg) : null;

  const formatTime = (ts: any) => {
    if (!ts) return null;
    const d = new Date(ts);
    if (isNaN(d.getTime())) return String(ts);
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
  };

  const portionStr = row.portion_number ? `P-${String(row.portion_number).padStart(2, '0')}` : 'P-01';

  return {
    id: Number(row.visit_id),
    portion_id: row.portion_id ? Number(row.portion_id) : null,
    visit_number: row.visit_number || null,
    reception_number: row.reception_number || null,
    vehicle_number: row.vehicle_number || '',
    portion_number: portionStr,
    token_number: row.token_number || null,
    zonal_contractor_name: row.zonal_contractor_name || 'ZMCC / Contractor',
    status: (row.current_status as ProcessStatus) || 'Dispatched',

    dispatch_date: dateStr,
    dispatch_day: daysOfWeek[opDate.getDay()],
    dispatch_week: Math.ceil(opDate.getDate() / 7) + 28,
    dispatch_month: monthsOfYear[opDate.getMonth()],
    dispatch_year: opDate.getFullYear(),
    zonal_contractor_dispatch_time: formatTime(row.dispatch_timestamp) || '07:15',
    scheduled_arrival_time: '09:15',
    dispatch_kg_gross: grossKg,
    dispatch_liters_gross: grossLiters,
    dispatch_tests: 'COB: Pass, Alcohol: 75% Pass',
    dispatch_fat: dispatchFat,
    dispatch_lr: dispatchLr,

    igp_date: row.entry_timestamp ? new Date(row.entry_timestamp).toISOString().split('T')[0] : null,
    igp_time: formatTime(row.entry_timestamp),
    out_from_gate_time: formatTime(row.exit_timestamp),

    sampling_date: row.sampling_start_timestamp ? new Date(row.sampling_start_timestamp).toISOString().split('T')[0] : null,
    sampling_time_start: formatTime(row.sampling_start_timestamp),
    sampling_time_end: formatTime(row.sampling_end_timestamp),
    sampling_fat: samplingFat,
    sampling_lr: samplingLr,
    b_mbrt_minutes_test: row.b_mbrt_minutes_test ? Number(row.b_mbrt_minutes_test) : (row.plant_decision === 'Rejected' ? 45 : 210),
    calculated_status: row.plant_decision || 'Accepted',
    rejection_reasons: row.plant_rejection_reason || null,
    borderline_warning: row.sampling_fat ? Boolean(row.sampling_fat < 3.5 || samplingLr < 27.5) : false,

    first_weight_time: formatTime(row.gross_timestamp),
    first_weight_of_vehicle: firstWeightKg,
    second_weight_time: formatTime(row.tare_timestamp),
    second_weight_of_vehicle: secondWeightKg,

    reception_date: row.pump_start_timestamp ? new Date(row.pump_start_timestamp).toISOString().split('T')[0] : null,
    reception_start_time: formatTime(row.pump_start_timestamp),
    reception_end_time: formatTime(row.pump_end_timestamp),
    silo_storage_id: row.silo_number || null,

    created_at: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
  };
}

export async function getAllLogs(): Promise<MilkProcessLog[]> {
  try {
    const query = `
      SELECT 
        vv.id AS visit_id,
        vv.visit_number,
        vv.reception_number,
        vv.vehicle_number,
        vv.token_number,
        vv.operational_date,
        vv.current_status,
        vv.created_at,
        vv.updated_at,
        vp.id AS portion_id,
        vp.portion_number,
        vp.declared_quantity_kg,
        vp.plant_decision,
        vp.plant_rejection_reason,
        di.dispatch_number,
        di.dispatch_timestamp,
        gl.entry_timestamp,
        gl.exit_timestamp,
        wt.gross_weight_kg,
        wt.gross_timestamp,
        wt.tare_weight_kg,
        wt.tare_timestamp,
        wt.net_weight_kg,
        ul.silo_number,
        ul.pump_start_timestamp,
        ul.pump_end_timestamp,
        (SELECT numeric_value FROM dispatch_lab_result dlr WHERE dlr.portion_id = vp.id AND dlr.test_id = 1 LIMIT 1) AS dispatch_fat,
        (SELECT numeric_value FROM dispatch_lab_result dlr WHERE dlr.portion_id = vp.id AND dlr.test_id = 2 LIMIT 1) AS dispatch_lr,
        (SELECT numeric_value FROM plant_lab_result plr WHERE plr.portion_id = vp.id AND plr.test_id = 1 LIMIT 1) AS sampling_fat,
        (SELECT numeric_value FROM plant_lab_result plr WHERE plr.portion_id = vp.id AND plr.test_id = 2 LIMIT 1) AS sampling_lr,
        (SELECT numeric_value FROM plant_lab_result plr WHERE plr.portion_id = vp.id AND plr.test_id = 4 LIMIT 1) AS b_mbrt_minutes_test,
        (SELECT min(sample_timestamp) FROM plant_lab_result plr WHERE plr.portion_id = vp.id) AS sampling_start_timestamp,
        (SELECT max(result_timestamp) FROM plant_lab_result plr WHERE plr.portion_id = vp.id) AS sampling_end_timestamp
      FROM vehicle_visit vv
      JOIN visit_portion vp ON vv.id = vp.visit_id
      LEFT JOIN dispatch_info di ON vp.id = di.portion_id
      LEFT JOIN gate_log gl ON vv.id = gl.visit_id
      LEFT JOIN weight_ticket wt ON vv.id = wt.visit_id
      LEFT JOIN unloading_log ul ON vp.id = ul.portion_id
      ORDER BY vv.id DESC;
    `;

    const res = await pool.query(query);
    if (res.rows && res.rows.length > 0) {
      const logs = res.rows.map(mapPgRowToLog);
      return logs.map(l => computeRuntimeMetrics(l)).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }
  } catch (err) {
    console.error('PostgreSQL getAllLogs error, fallback to memory:', err);
  }

  return [];
}

export async function getLogById(id: number): Promise<MilkProcessLog | null> {
  const all = await getAllLogs();
  const found = all.find(l => l.id === id);
  return found || null;
}

export async function createLog(data: Partial<MilkProcessLog>): Promise<MilkProcessLog> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const vNum = data.vehicle_number || '';
    const zName = data.zonal_contractor_name || 'ZMCC / Contractor';
    const portionNum = data.portion_number ? parseInt(data.portion_number.replace(/\D/g, '')) || 1 : 1;
    const grossKg = data.dispatch_kg_gross || 12000;
    const now = new Date();

    // 1. Insert vehicle_visit
    const visitRes = await client.query(`
      INSERT INTO vehicle_visit (visit_number, vehicle_number, token_number, operational_date, current_status, created_by, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, 1, NOW(), NOW())
      RETURNING id;
    `, [`VISIT-${Date.now()}`, vNum, data.token_number || null, now, data.status || 'Dispatched']);

    const visitId = visitRes.rows[0].id;

    // 2. Insert visit_portion
    const portionRes = await client.query(`
      INSERT INTO visit_portion (visit_id, portion_number, current_status, declared_quantity_kg, plant_decision, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'Accepted', NOW(), NOW())
      RETURNING id;
    `, [visitId, portionNum, data.status || 'Dispatched', grossKg]);

    const portionId = portionRes.rows[0].id;

    // 3. Insert dispatch_info
    await client.query(`
      INSERT INTO dispatch_info (portion_id, dispatch_number, dispatch_timestamp, recorded_by, created_at, updated_at)
      VALUES ($1, $2, NOW(), 1, NOW(), NOW());
    `, [portionId, `DISP-${Date.now()}`]);

    // 4. Insert dispatch_lab_result (Fat, LR, SNF)
    const fatVal = data.dispatch_fat || 3.8;
    const lrVal = data.dispatch_lr || 28.0;
    const snfVal = Number(((lrVal / 4) + (0.22 * fatVal) + 0.72).toFixed(2));

    await client.query(`
      INSERT INTO dispatch_lab_result (visit_id, portion_id, test_id, sample_timestamp, result_timestamp, numeric_value, is_passed, tested_by, created_at, updated_at)
      VALUES 
        ($1, $2, 1, NOW(), NOW(), $3, true, 1, NOW(), NOW()),
        ($1, $2, 2, NOW(), NOW(), $4, true, 1, NOW(), NOW()),
        ($1, $2, 3, NOW(), NOW(), $5, true, 1, NOW(), NOW());
    `, [visitId, portionId, fatVal, lrVal, snfVal]);

    await client.query('COMMIT');

    const created = await getLogById(Number(visitId));
    if (!created) {
      throw new Error('Failed to retrieve newly created log record from database.');
    }
    return created;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error in createLog PostgreSQL:', err);
    throw new Error(`Database transaction failed: ${err instanceof Error ? err.message : 'Failed to create log'}`);
  } finally {
    client.release();
  }
}

export async function updateLog(
  id: number,
  updates: Partial<MilkProcessLog>,
  user?: User | null
): Promise<MilkProcessLog | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Get portion ID for this visit
    const portionRes = await client.query('SELECT id FROM visit_portion WHERE visit_id = $1 LIMIT 1', [id]);
    const portionId = portionRes.rows[0]?.id;

    // Update status if provided
    if (updates.status) {
      await client.query('UPDATE vehicle_visit SET current_status = $1, updated_at = NOW() WHERE id = $2', [updates.status, id]);
      if (portionId) {
        await client.query('UPDATE visit_portion SET current_status = $1, updated_at = NOW() WHERE id = $2', [updates.status, portionId]);
      }
    }

    // Token Issue
    if (updates.token_number || updates.igp_time) {
      await client.query('UPDATE vehicle_visit SET token_number = COALESCE($1, token_number), updated_at = NOW() WHERE id = $2', [updates.token_number, id]);
      await client.query(`
        INSERT INTO gate_log (visit_id, entry_timestamp, entry_guard_id, created_at, updated_at)
        VALUES ($1, NOW(), 3, NOW(), NOW())
        ON CONFLICT (visit_id) DO UPDATE SET entry_timestamp = NOW(), updated_at = NOW();
      `, [id]);
    }

    // Gate Out
    if (updates.out_from_gate_time) {
      await client.query(`
        UPDATE gate_log SET exit_timestamp = NOW(), exit_guard_id = 3, updated_at = NOW() WHERE visit_id = $1;
      `, [id]);
    }

    // QA Lab Tests
    if (updates.sampling_fat !== undefined || updates.sampling_lr !== undefined || updates.calculated_status) {
      if (updates.calculated_status && portionId) {
        await client.query(`
          UPDATE visit_portion 
          SET plant_decision = $1, plant_rejection_reason = $2, plant_decided_by = 5, plant_decided_at = NOW(), updated_at = NOW()
          WHERE id = $3;
        `, [updates.calculated_status, updates.rejection_reasons || null, portionId]);
      }

      if (portionId) {
        const fatVal = updates.sampling_fat || updates.dispatch_fat || 3.8;
        const lrVal = updates.sampling_lr || updates.dispatch_lr || 28.0;
        const snfVal = Number(((lrVal / 4) + (0.22 * fatVal) + 0.72).toFixed(2));
        const mbrtMins = updates.b_mbrt_minutes_test || 210;

        await client.query(`
          INSERT INTO plant_lab_result (visit_id, portion_id, test_id, sample_timestamp, result_timestamp, numeric_value, is_passed, tested_by, created_at, updated_at)
          VALUES 
            ($1, $2, 1, NOW(), NOW(), $3, true, 5, NOW(), NOW()),
            ($1, $2, 2, NOW(), NOW(), $4, true, 5, NOW(), NOW()),
            ($1, $2, 3, NOW(), NOW(), $5, true, 5, NOW(), NOW()),
            ($1, $2, 4, NOW(), NOW(), $6, $7, 5, NOW(), NOW());
        `, [id, portionId, fatVal, lrVal, snfVal, mbrtMins, updates.calculated_status !== 'Rejected']);
      }
    }

    // Weighbridge Scale 1st Weight
    if (updates.first_weight_of_vehicle !== undefined) {
      const ticketNum = `WT-2026-${String(id).padStart(4, '0')}`;
      await client.query(`
        INSERT INTO weight_ticket (visit_id, ticket_number, gross_weight_kg, gross_timestamp, gross_recorded_by, created_at, updated_at)
        VALUES ($1, $2, $3, NOW(), 7, NOW(), NOW())
        ON CONFLICT (visit_id) DO UPDATE SET gross_weight_kg = $3, gross_timestamp = NOW(), updated_at = NOW();
      `, [id, ticketNum, updates.first_weight_of_vehicle]);
    }

    // Weighbridge Scale 2nd Weight
    if (updates.second_weight_of_vehicle !== undefined) {
      await client.query(`
        UPDATE weight_ticket 
        SET tare_weight_kg = $1, tare_timestamp = NOW(), tare_recorded_by = 7, net_weight_kg = (gross_weight_kg - $1), updated_at = NOW()
        WHERE visit_id = $2;
      `, [updates.second_weight_of_vehicle, id]);
    }

    // Silo Reception
    if (updates.silo_storage_id && portionId) {
      await client.query(`
        INSERT INTO unloading_log (portion_id, silo_number, pump_start_timestamp, pump_end_timestamp, started_by, completed_by, created_at, updated_at)
        VALUES ($1, $2, NOW(), NOW(), 7, 7, NOW(), NOW())
        ON CONFLICT (portion_id) DO UPDATE SET silo_number = $2, pump_end_timestamp = NOW(), updated_at = NOW();
      `, [portionId, updates.silo_storage_id]);
    }

    // Record Audit Log if user passed
    if (user) {
      for (const key of Object.keys(updates) as (keyof MilkProcessLog)[]) {
        const newVal = updates[key] !== undefined && updates[key] !== null ? String(updates[key]) : null;
        await client.query(`
          INSERT INTO audit_log (table_name, record_id, action, old_values, new_values, user_id, created_at)
          VALUES ('vehicle_visit', $1, $2, '{"field": "${key}"}'::jsonb, $3::jsonb, $4, NOW());
        `, [id, user.role === 'Correction_Officer' ? 'CORRECTION' : 'UPDATE', JSON.stringify({ [key]: newVal }), user.id ? parseInt(user.id.replace(/\D/g, '')) || 1 : 1]);
      }
    }

    await client.query('COMMIT');
    const updated = await getLogById(id);
    if (updated) return updated;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error updating log in PostgreSQL:', err);
  } finally {
    client.release();
  }

  return null;
}

export async function getAuditLogsForLog(logId: number): Promise<DataAuditLog[]> {
  try {
    const res = await pool.query(`
      SELECT al.*, u.full_name AS modifier_name, u.role AS modifier_role
      FROM audit_log al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.record_id = $1
      ORDER BY al.created_at DESC;
    `, [logId]);

    if (res.rows && res.rows.length > 0) {
      return res.rows.map((row: any) => ({
        id: Number(row.id),
        log_id: Number(row.record_id),
        modified_by_user: row.modifier_name || 'System Operator',
        role: row.modifier_role || 'Correction_Officer',
        column_name: row.action || 'status',
        original_value: row.old_values ? JSON.stringify(row.old_values) : null,
        new_value: row.new_values ? JSON.stringify(row.new_values) : null,
        action_type: row.action as any || 'UPDATE',
        timestamp: new Date(row.created_at).toISOString()
      }));
    }
  } catch (err) {
    console.error('Error fetching audit logs from PostgreSQL:', err);
  }

  return [];
}

export async function revertLogField(
  logId: number,
  auditLogId: number,
  adminUser: User
): Promise<MilkProcessLog | null> {
  try {
    await pool.query(`
      INSERT INTO audit_log (table_name, record_id, action, old_values, new_values, user_id, created_at)
      VALUES ('vehicle_visit', $1, 'REVERT', '{"revert_action": "admin_rollback"}'::jsonb, $2::jsonb, $3, NOW());
    `, [logId, JSON.stringify({ audit_id: auditLogId }), parseInt(adminUser.id.replace(/\D/g, '')) || 11]);

    return await getLogById(logId);
  } catch (err) {
    console.error('Error performing rollback in PostgreSQL:', err);
  }
  return null;
}
