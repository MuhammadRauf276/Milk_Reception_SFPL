import React from 'react';
import { DailyReportDashboard } from '@/frontend/modules/super-admin/daily-report/DailyReportDashboard';

export const metadata = {
  title: 'Daily Operations & Quality Report | Super Admin',
  description: 'Daily report across Mobile Tester intake, ZMCC lab receptions, Plant QA, exceptions audit, and supply chain losses.',
};

export default function SuperAdminDailyReportPage() {
  return <DailyReportDashboard />;
}
