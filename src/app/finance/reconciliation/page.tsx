'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { User } from '@/backend/core/types';
import { Header } from '@/frontend/modules/shared/Header';
import { FinanceReconciliationWorkspace } from '@/frontend/modules/finance/FinanceReconciliationWorkspace';

export default function FinanceReconciliationPage() {
  const router = useRouter(); const [user, setUser] = useState<User | null>(null);
  useEffect(() => { fetch('/api/auth/me').then(async (response) => { const body = await response.json(); if (!response.ok || !body.user) return router.replace('/login'); if (!['FINANCE_ACCOUNTS', 'SUPER_ADMIN'].includes(body.user.role)) return router.replace('/workspace-unavailable'); setUser(body.user); }).catch(() => router.replace('/login')); }, [router]);
  if (!user) return <div className="p-8 text-center text-sm text-slate-500">Verifying Finance access...</div>;
  return <div className="min-h-screen bg-[#FDFBF9] text-[#111311]"><Header currentUser={user} title="Finance Reconciliation" showBranding /><main className="mx-auto max-w-7xl p-4 sm:p-6"><FinanceReconciliationWorkspace /></main></div>;
}
