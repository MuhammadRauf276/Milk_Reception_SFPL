'use client';

import React from 'react';
import { ManagementShell } from '@/frontend/modules/shared/ManagementShell';
import { RequestCorrectionPanel } from '@/frontend/modules/governance/RequestCorrectionPanel';
import { REQUESTING_ROLES } from '@/lib/recordEditor';

export default function RequestCorrectionPage() {
  return (
    <ManagementShell title="Request correction" allowedRoles={REQUESTING_ROLES}>
      {() => <RequestCorrectionPanel />}
    </ManagementShell>
  );
}
