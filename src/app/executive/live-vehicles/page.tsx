'use client';

import React, { Suspense } from 'react';
import { PageLoader } from '@/components/ui/spinner';
import { ManagementShell } from '@/frontend/modules/shared/ManagementShell';
import { ExecutiveLiveVehicles } from '@/frontend/modules/executive/ExecutiveLiveVehicles';

const VEHICLE_ROLES = ['EXECUTIVE_MANAGEMENT', 'QA_HEAD'] as const;

export default function VehiclesPage() {
  return (
    <ManagementShell title="Vehicles" allowedRoles={VEHICLE_ROLES}>
      {(user) => (
        <Suspense fallback={<PageLoader label="Loading vehicles…" />}>
          <ExecutiveLiveVehicles showPhotos={user.role === 'EXECUTIVE_MANAGEMENT'} />
        </Suspense>
      )}
    </ManagementShell>
  );
}
