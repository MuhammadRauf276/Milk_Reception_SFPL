'use client';

import React from 'react';
import { ManagementShell } from '@/frontend/modules/shared/ManagementShell';
import { ApprovalInbox } from '@/frontend/modules/approvals/ApprovalInbox';

const APPROVER_ROLES = [
  'HEAD_OF_MPD',
  'EXECUTIVE_MANAGEMENT',
  'PRODUCTION_HEAD',
  'QA_HEAD',
  'ADMIN_HEAD',
  'FINANCE_ACCOUNTS',
  'SUPER_ADMIN',
  'DATA_EXECUTIVE',
  'ZMCC_MANAGER',
] as const;

export default function ApprovalsPage() {
  return (
    <ManagementShell title="Approvals" allowedRoles={APPROVER_ROLES}>
      {(user) => (
        <div className="space-y-6">
          <ApprovalInbox currentUser={user} initialStage="ALL" />
        </div>
      )}
    </ManagementShell>
  );
}
