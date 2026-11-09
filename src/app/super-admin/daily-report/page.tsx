import React from 'react';
import { DailyReportDashboard } from '@/frontend/modules/super-admin/daily-report/DailyReportDashboard';

export const metadata = {
  title: 'Daily Operations & Quality Report | Super Admin',
  description: 'Daily milk intake, quality and loss report',
};

export default function SuperAdminDailyReportPage() {
  return <DailyReportDashboard />;
}
