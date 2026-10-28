'use client';

import React, { Suspense } from 'react';
import { ManagementShell } from '@/frontend/modules/shared/ManagementShell';
import { MpdSourcesWorkspace } from '@/frontend/modules/mpd/MpdSourcesWorkspace';

const SOURCES_ROLES = ['HEAD_OF_MPD', 'SUPER_ADMIN', 'DATA_EXECUTIVE'] as const;

export default function SourcesPage() {
  return (
    <ManagementShell title="Milk Sources & Contractors" allowedRoles={SOURCES_ROLES}>
      {() => (
        <Suspense fallback={null}>
          <MpdSourcesWorkspace />
        </Suspense>
      )}
    </ManagementShell>
  );
}
