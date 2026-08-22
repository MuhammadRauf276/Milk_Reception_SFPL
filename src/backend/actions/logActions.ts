'use server';

import { getOperationalLogs, getOperationalLogById, OperationalLogFilters } from '@backend/services/operationalReadModelService';
import { getCurrentUser } from '@core/auth';
import { MilkProcessLog } from '@core/types';

export type LogFilters = OperationalLogFilters;

export async function fetchAllMilkLogs(filters?: LogFilters): Promise<MilkProcessLog[]> {
  let user = null;
  try {
    user = await getCurrentUser();
  } catch (_err) {
    // Handled when called outside HTTP request context (e.g., test runner)
  }

  return await getOperationalLogs(filters, user);
}

export async function fetchMilkLogById(id: number): Promise<MilkProcessLog | null> {
  let user = null;
  try {
    user = await getCurrentUser();
  } catch (_err) {
    // Handled when called outside HTTP request context
  }

  return await getOperationalLogById(id, user);
}

