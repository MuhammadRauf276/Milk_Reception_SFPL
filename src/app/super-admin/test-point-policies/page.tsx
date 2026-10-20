'use client';

import React from 'react';
import { TestPointPolicyMatrix } from '@/frontend/modules/super-admin/TestPointPolicyMatrix';

// Access is enforced by the super-admin layout (UI) and by the API (server): SA edits, DE views.
export default function SuperAdminTestPointPoliciesPage() {
  return <TestPointPolicyMatrix />;
}
