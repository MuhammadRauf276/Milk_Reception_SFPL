'use client';

import React from 'react';
import { ManagementShell } from '@/frontend/modules/shared/ManagementShell';
import { MyWorkWorkspace } from '@/frontend/modules/governance/MyWorkWorkspace';
import { REQUESTING_ROLES } from '@/lib/recordEditor';

export default function RequestCorrectionPage() {
  return (
    <ManagementShell title="My work" allowedRoles={REQUESTING_ROLES}>
      {() => <MyWorkWorkspace />}
    </ManagementShell>
  );
}
