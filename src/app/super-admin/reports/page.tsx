import React from 'react';
import { ReportsAndGovernanceWorkspace } from '@/frontend/modules/super-admin/reports/ReportsAndGovernanceWorkspace';

export const metadata = {
  title: 'Executive Reports & Governance | Super Admin',
  description: 'Centralized executive workspace for daily operations reports, cross-role hierarchy audit, and warning limit policies.',
};

export default function SuperAdminReportsPage() {
  return <ReportsAndGovernanceWorkspace />;
}
