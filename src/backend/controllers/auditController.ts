import { getAuditLogsForLog, revertLogField, getAllLogs } from '@core/db';
import { User } from '@core/types';

export async function fetchAuditLogs(logId: number) {
  return await getAuditLogsForLog(logId);
}

export async function performRollback(logId: number, auditLogId: number, adminUser: User) {
  return await revertLogField(logId, auditLogId, adminUser);
}

export async function calculateQueueAnalytics() {
  const logs = await getAllLogs();
  const activeInPlant = logs.filter((l) => l.status !== 'Completed');

  const laneCounts = {
    Dispatched: logs.filter((l) => l.status === 'Dispatched').length,
    TokenIssued: logs.filter((l) => l.status === 'Token Issued').length,
    Sampling: logs.filter((l) => l.status === 'Sampling').length,
    FirstWeight: logs.filter((l) => l.status === 'First Weight').length,
    SiloReception: logs.filter((l) => l.status === 'Silo Reception').length,
    Completed: logs.filter((l) => l.status === 'Completed').length,
  };

  return {
    totalLogs: logs.length,
    activeInPlant: activeInPlant.length,
    laneCounts,
  };
}
