'use server';

import { createLog, updateLog, getAllLogs, getLogById } from '@core/db';
import { getCurrentUser, filterUpdatesByRole } from '@core/auth';
import { MilkProcessLog } from '@core/types';

export interface LogFilters {
  fromDate?: string;
  toDate?: string;
  contractor?: string;
  status?: string;
  search?: string;
}

export async function fetchAllMilkLogs(filters?: LogFilters) {
  let user = null;
  try {
    user = await getCurrentUser();
  } catch (_err) {
    // Handled when called outside HTTP request context (e.g., test runner)
  }
  let logs = await getAllLogs();

  // 1. Authenticated Zone Manager -> 2. Assigned Zone (MANDATORY SERVER LOCK)
  if (user && user.role === 'MPD_Zone_Manager') {
    const managerZone = user.zone || 'ZMCC / Contractor';
    logs = logs.filter((l) => l.zonal_contractor_name === managerZone);
  }

  if (!filters) return logs;

  // 3. From Date and To Date
  if (filters.fromDate || filters.toDate) {
    logs = logs.filter((l) => {
      const dateStr = l.dispatch_date || (l.created_at ? l.created_at.split('T')[0] : '');
      if (!dateStr) return false;
      if (filters.fromDate && dateStr < filters.fromDate) return false;
      if (filters.toDate && dateStr > filters.toDate) return false;
      return true;
    });
  }

  // 4. Contractor filter
  if (filters.contractor && filters.contractor !== 'ALL') {
    logs = logs.filter((l) => l.zonal_contractor_name === filters.contractor);
  }

  // 5. Status / Plant QA decision filter
  if (filters.status && filters.status !== 'ALL') {
    const filterStatusUpper = filters.status.toUpperCase();
    logs = logs.filter((l) => {
      const stUpper = String(l.status).toUpperCase();
      const calcUpper = String(l.calculated_status || '').toUpperCase();
      if (filterStatusUpper === 'ACCEPTED') return calcUpper === 'ACCEPTED';
      if (filterStatusUpper === 'REJECTED') return calcUpper === 'REJECTED';
      if (filterStatusUpper === 'PENDING') return calcUpper === 'PENDING' || (!l.calculated_status && stUpper !== 'COMPLETED');
      return l.status === filters.status || stUpper === filterStatusUpper;
    });
  }

  // 6. Search term
  if (filters.search && filters.search.trim()) {
    const q = filters.search.toLowerCase().trim();
    logs = logs.filter((l) => {
      return (
        l.vehicle_number.toLowerCase().includes(q) ||
        (l.token_number && l.token_number.toLowerCase().includes(q)) ||
        l.zonal_contractor_name.toLowerCase().includes(q)
      );
    });
  }

  return logs;
}

export async function fetchMilkLogById(id: number) {
  return await getLogById(id);
}

export async function createNewDispatch(data: Partial<MilkProcessLog>) {
  const user = await getCurrentUser();
  if (!user || (user.role !== 'MPD' && user.role !== 'Admin')) {
    throw new Error('Unauthorized: Only MPD or Admin can record new dispatches');
  }

  return await createLog(data);
}

export async function updateMilkLogByRole(id: number, updates: Partial<MilkProcessLog>) {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Unauthenticated user');
  }

  if (user.role === 'Management') {
    throw new Error('Unauthorized: Management is strictly read-only');
  }

  const sanitized = filterUpdatesByRole(user.role, updates);
  return await updateLog(id, sanitized, user);
}
