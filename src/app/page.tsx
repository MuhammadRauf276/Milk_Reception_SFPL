import React from 'react';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@core/auth';
import { KanbanBoard } from '@modules/dashboard/KanbanBoard';

export default async function HomePage() {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    redirect('/login');
  }

  const role = currentUser.role as string;

  if (role === 'Production_Operator' || role === 'PRODUCTION_OPERATOR' || role === 'Production') {
    redirect('/department/production');
  }

  if (role === 'MPD_Operator' || role === 'MPD') {
    redirect('/department/mpd');
  }

  if (role === 'Security_Operator' || role === 'Security_Weight') {
    redirect('/department/security');
  }

  if (role === 'QA_Operator' || role === 'QA') {
    redirect('/department/qa');
  }

  if (role === 'WEIGHBRIDGE_OPERATOR' || role === 'Weighbridge_Operator') {
    redirect('/department/weighbridge');
  }

  if (role === 'Security_Manager') {
    redirect('/department/security-manager');
  }

  return <KanbanBoard />;
}
