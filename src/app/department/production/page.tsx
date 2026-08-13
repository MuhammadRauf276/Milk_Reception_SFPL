import React from 'react';
import { redirect } from 'next/navigation';
import { Sidebar } from '@modules/shared/Sidebar';
import { Header } from '@modules/shared/Header';
import { ProductionUnloadingWorkspace } from '@modules/dashboard/ProductionUnloadingWorkspace';
import { getCurrentUser } from '@core/auth';

export default async function ProductionDepartmentPage() {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    redirect('/login');
  }

  const roleStr = currentUser.role as string;

  // Allow Admin, Production_Operator, PRODUCTION_OPERATOR, Production_Manager, Production
  const allowedRoles = ['Admin', 'Production_Operator', 'PRODUCTION_OPERATOR', 'Production_Manager', 'Production'];
  if (!allowedRoles.includes(roleStr)) {
    redirect('/login');
  }

  // Operator pages omit sidebar for clean focused workspace
  const showSidebar = roleStr !== 'Production_Operator' && roleStr !== 'PRODUCTION_OPERATOR' && roleStr !== 'Production';

  return (
    <div className="flex h-screen bg-[#F4EFE3] overflow-hidden">
      {showSidebar && <Sidebar currentUser={currentUser} activeCount={0} />}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header currentUser={currentUser} title="Production" showBranding={true} />
        <main className="flex-1 overflow-y-auto p-6">
          <ProductionUnloadingWorkspace currentUser={currentUser} />
        </main>
      </div>
    </div>
  );
}
