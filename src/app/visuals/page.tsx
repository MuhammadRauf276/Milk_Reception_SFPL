'use client';

import React from 'react';
import { ManagementShell } from '@/frontend/modules/shared/ManagementShell';
import { VisualsWorkspace } from '@/frontend/modules/visuals/VisualsWorkspace';
import { VISUALS_ROLES } from '@/backend/modules/management-reporting/visuals/common';

export default function VisualsPage() {
  return (
    <ManagementShell title="Visuals" allowedRoles={VISUALS_ROLES}>
      {(user) => <VisualsWorkspace currentUser={user} />}
    </ManagementShell>
  );
}
