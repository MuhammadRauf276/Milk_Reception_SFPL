import React from 'react';
import { ReportsAndGovernanceWorkspace } from '@/frontend/modules/super-admin/reports/ReportsAndGovernanceWorkspace';

export const metadata = {
  title: 'Reports | Super Admin',
  description: 'Daily reports, senior actions and warning limits',
};

export default function SuperAdminReportsPage() {
  return <ReportsAndGovernanceWorkspace />;
}
