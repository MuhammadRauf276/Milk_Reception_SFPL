'use client';

import React from 'react';
import { ManagementShell } from '@/frontend/modules/shared/ManagementShell';
import { MpdExecutiveWorkspace } from '@/frontend/modules/mpd/MpdExecutiveWorkspace';

const COMMAND_ROLES = ['HEAD_OF_MPD', 'EXECUTIVE_MANAGEMENT', 'SUPER_ADMIN', 'DATA_EXECUTIVE'] as const;

export default function CommandCenterPage() {
  return (
    <ManagementShell title="Command Center" allowedRoles={COMMAND_ROLES}>
      {(user) => <MpdExecutiveWorkspace currentUser={user} />}
    </ManagementShell>
  );
}
