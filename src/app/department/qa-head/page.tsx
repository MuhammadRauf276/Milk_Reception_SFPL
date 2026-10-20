'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Header } from '@modules/shared/Header';
import { HierarchicalNavDrawer } from '@modules/shared/navigation/HierarchicalNavDrawer';
import { User } from '@core/types';
import { ShieldAlert, Sliders } from 'lucide-react';
import { PageLoader } from '@/components/ui/spinner';
import { PageTransition } from '@/components/motion/page-transition';
import { UnifiedStagePoliciesRulesWorkspace } from '@/frontend/modules/super-admin/UnifiedStagePoliciesRulesWorkspace';
import { ApprovalInbox } from '@/frontend/modules/approvals/ApprovalInbox';

export default function QAHeadDepartmentPage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const hamburgerButtonRef = useRef<HTMLButtonElement | null>(null);

  const [activeTab, setActiveTab] = useState<'EXCEPTIONS' | 'POLICIES'>('EXCEPTIONS');

  useEffect(() => {
    async function loadUser() {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
        }
      } catch (err) {
        console.error('Failed to load user', err);
      } finally {
        setLoading(false);
      }
    }
    loadUser();
  }, []);

  if (loading) {
    return <PageLoader label="Loading AVP-QA Workspace…" className="min-h-screen" />;
  }

  const isEditor = ['SUPER_ADMIN', 'DATA_EXECUTIVE', 'DATA_ANALYST'].includes(user?.role || '');

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col w-full max-w-full overflow-x-hidden">
      <Header
        currentUser={user}
        title="AVP, Quality Assurance"
        showBranding={true}
        showMenuButton={true}
        onMenuClick={() => setIsDrawerOpen(true)}
        menuButtonRef={hamburgerButtonRef}
      />

      <HierarchicalNavDrawer
        currentUser={user}
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        triggerButtonRef={hamburgerButtonRef}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        <PageTransition>
          {/* Workspace Tabs */}
          <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-xl border border-border shadow-2xs">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveTab('EXCEPTIONS')}
                className={`px-4 py-2 rounded-lg text-xs font-semibold transition flex items-center gap-2 ${
                  activeTab === 'EXCEPTIONS'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <ShieldAlert className="w-4 h-4" />
                <span>Pending Exceptions</span>
                {pendingCount !== null && pendingCount > 0 && (
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      activeTab === 'EXCEPTIONS' ? 'bg-white text-amber-700' : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {pendingCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('POLICIES')}
                className={`px-4 py-2 rounded-lg text-xs font-semibold transition flex items-center gap-2 ${
                  activeTab === 'POLICIES'
                    ? 'bg-primary text-white shadow-xs'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <Sliders className="w-4 h-4" />
                <span>Stage Policies & Rules</span>
              </button>
            </div>
          </div>

          {activeTab === 'EXCEPTIONS' ? (
            <ApprovalInbox
              currentUser={user}
              fixedStage="STAGE_4"
              onCountChange={(c) => setPendingCount(c.stage4)}
            />
          ) : (
            <div className="bg-white rounded-xl border border-border p-6 shadow-2xs">
              <UnifiedStagePoliciesRulesWorkspace
                currentUser={user}
                defaultTestingPoint="PLANT_QA"
                forceReadOnly={!isEditor}
              />
            </div>
          )}
        </PageTransition>
      </main>
    </div>
  );
}
