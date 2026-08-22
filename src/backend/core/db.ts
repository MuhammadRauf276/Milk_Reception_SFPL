import { Pool } from 'pg';
import { PrismaClient } from '@prisma/client';
import { MilkProcessLog, DataAuditLog, User } from './types';
import { getOperationalLogById } from '../services/operationalReadModelService';

export const prisma = new PrismaClient();

// Initialize PostgreSQL Connection Pool using env DATABASE_URL
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function getAuditLogsForLog(logId: number): Promise<DataAuditLog[]> {
  try {
    const res = await pool.query(
      `
      SELECT al.*, u.full_name AS modifier_name, u.role AS modifier_role
      FROM audit_log al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.record_id = $1
      ORDER BY al.created_at DESC;
    `,
      [String(logId)]
    );

    if (res.rows && res.rows.length > 0) {
      return res.rows.map((row: any) => ({
        id: Number(row.id),
        log_id: Number(row.record_id) || logId,
        modified_by_user: row.modifier_name || 'System Operator',
        role: row.modifier_role || 'Correction_Officer',
        column_name: row.action || 'status',
        original_value: row.old_values ? JSON.stringify(row.old_values) : null,
        new_value: row.new_values ? JSON.stringify(row.new_values) : null,
        action_type: (row.action as any) || 'UPDATE',
        timestamp: new Date(row.created_at).toISOString(),
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
    await pool.query(
      `
      INSERT INTO audit_log (table_name, record_id, action, old_values, new_values, user_id, created_at)
      VALUES ('vehicle_visit', $1, 'REVERT', '{"revert_action": "admin_rollback"}'::jsonb, $2::jsonb, $3, NOW());
    `,
      [String(logId), JSON.stringify({ audit_id: auditLogId }), parseInt(adminUser.id.replace(/\D/g, '')) || 11]
    );

    return await getOperationalLogById(logId, adminUser);
  } catch (err) {
    console.error('Error performing rollback in PostgreSQL:', err);
  }
  return null;
}

