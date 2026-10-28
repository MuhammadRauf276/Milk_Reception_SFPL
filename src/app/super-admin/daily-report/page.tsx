import React from 'react';
import { DailyReportDashboard } from '@/frontend/modules/super-admin/daily-report/DailyReportDashboard';

export const metadata = {
  title: 'Daily Operations & Quality Report | Super Admin',
  description: 'Enterprise daily report across MOT village intake, ZMCC lab receptions, Plant QA, exceptions audit, and supply chain losses.',
};

export default function SuperAdminDailyReportPage() {
  return <DailyReportDashboard />;
}
