'use client';

import React from 'react';
import { ManagementShell } from '@/frontend/modules/shared/ManagementShell';
import { MySubmittedRequestsPanel } from '@/frontend/modules/approvals/MySubmittedRequestsPanel';

const ALL_AUTHENTICATED_ROLES = [
  'SUPER_ADMIN',
  'DATA_EXECUTIVE',
  'HEAD_OF_MPD',
  'ZMCC_MANAGER',
  'QA_HEAD',
  'PRODUCTION_HEAD',
  'ADMIN_HEAD',
  'FINANCE_ACCOUNTS',
  'CONTRACTOR_MANAGER',
  'MDO',
  'PHE_OPERATOR',
  'MOT',
  'ZMCC_LAB_ATTENDANT',
  'SECURITY_OPERATOR',
  'QA_LAB_ATTENDANT',
  'WEIGHBRIDGE_OPERATOR',
  'PRODUCTION_RECEPTION_OPERATOR',
  'EXECUTIVE_MANAGEMENT',
  'DATA_ANALYST',
] as const;

export default function MyRequestsPage() {
  return (
    <ManagementShell title="My Requests" allowedRoles={ALL_AUTHENTICATED_ROLES}>
      {(_user) => (
        <div className="max-w-5xl mx-auto space-y-6">
          <MySubmittedRequestsPanel />
        </div>
      )}
    </ManagementShell>
  );
}
