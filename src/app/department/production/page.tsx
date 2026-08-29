import React from 'react';
import { redirect } from 'next/navigation';
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

  return (
    <div className="min-h-screen bg-[#FDFBF9] text-[#111311] flex flex-col font-sans w-full max-w-full overflow-x-hidden">
      <Header currentUser={currentUser} title="Production" showBranding={true} />
      <main className="flex-1 p-4 sm:p-6 overflow-y-auto w-full max-w-full">
        <ProductionUnloadingWorkspace currentUser={currentUser} />
      </main>
    </div>
  );
}
