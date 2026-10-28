'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { User } from '@core/types';
import { Header } from '@modules/shared/Header';
import { HierarchicalNavDrawer } from '@modules/shared/navigation/HierarchicalNavDrawer';
import { Truck, AlertCircle, Loader2 } from 'lucide-react';
import { PageLoader } from '@/components/ui/spinner';
import { PageTransition } from '@/components/motion/page-transition';
import { useOnlineStatus } from '@/frontend/hooks/useOnlineStatus';
import { canCoverMotWork } from '@/frontend/modules/zmcc/stage1Capabilities';
import { useMotSync } from '@/frontend/modules/mot/journey/useMotSync';
import { useMotGpsStream } from '@/frontend/modules/mot/journey/useMotGpsStream';
import { useMotJourney } from '@/frontend/modules/mot/journey/useMotJourney';
import { useCollection } from '@/frontend/modules/mot/journey/useCollection';
import { SyncBar } from '@/frontend/modules/mot/journey/SyncBar';
import { CoveringBanner } from '@/frontend/modules/mot/journey/CoveringBanner';
import { JourneyCard } from '@/frontend/modules/mot/journey/JourneyCard';
import { StopsList } from '@/frontend/modules/mot/journey/StopsList';
import { CollectionModal } from '@/frontend/modules/mot/journey/CollectionModal';
import { ReceiptModal } from '@/frontend/modules/mot/journey/ReceiptModal';
import { ReturnToPheModal } from '@/frontend/modules/mot/journey/ReturnToPheModal';
import { toast } from 'sonner';
import { COVER_HEADERS } from '@/frontend/modules/mot/journey/types';
import { saveCachedJourney } from '@/frontend/modules/mot/offlineStore';
import { ShopRequestSheet } from '@/frontend/modules/mot/journey/ShopRequestSheet';
import { useCurrentUser } from '@/frontend/hooks/useCurrentUser';

export default function MotPage() {
  const router = useRouter();
  const { currentUser, loadingUser } = useCurrentUser();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const hamburgerButtonRef = useRef<HTMLButtonElement | null>(null);

  const isOnline = useOnlineStatus();
  const sync = useMotSync();
  const {
    journey,
    setJourney,
    loadingJourney,
    journeyError,
    isCovering,
    coverJourneyId,
    coverJourneys,
    coverListError,
    selectCoverJourney,
  } = useMotJourney(currentUser, isOnline);

  const { deviceGps, latestFixRef, gpsBadge } = useMotGpsStream({
    journeyId: journey?.id ?? null,
    recordRoute: (journey?.status === 'COLLECTING' || journey?.status === 'RETURNING') && currentUser?.role === 'MOT',
    refreshUnsynced: sync.refreshUnsynced,
    triggerSync: sync.triggerSync,
  });

  const collection = useCollection({
    currentUser,
    journey,
    setJourney,
    isCovering,
    isOnline,
    latestFixRef,
    refreshUnsynced: sync.refreshUnsynced,
    triggerSync: sync.triggerSync,
    setSyncFeedback: sync.setSyncFeedback,
  });

  // Secondary sheets
  const [shopRequestOpen, setShopRequestOpen] = useState(false);

  // Return to PHE state
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [isSubmittingReturn, setIsSubmittingReturn] = useState(false);

  const handleReturnToPhe = useCallback(async () => {
    if (!journey) return;
    setIsSubmittingReturn(true);
    try {
      const url = isCovering && coverJourneyId
        ? `/api/zmcc/mot/journeys/current/return-to-phe?journeyId=${encodeURIComponent(coverJourneyId)}`
        : '/api/zmcc/mot/journeys/current/return-to-phe';
      const res = await fetch(url, {
        method: 'POST',
        headers: isCovering ? COVER_HEADERS : undefined,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to mark journey as returning to PHE.');
      }
      if (data.journey) {
        setJourney(data.journey);
        await saveCachedJourney(data.journey);
      } else {
        setJourney((prev) => (prev ? { ...prev, status: 'RETURNING' } : null));
      }
      setReturnModalOpen(false);
      toast.success('Journey marked as returning to PHE. PHE operator has been notified.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to return to PHE.';
      toast.error(msg);
    } finally {
      setIsSubmittingReturn(false);
    }
  }, [journey, isCovering, coverJourneyId, setJourney]);

  const handleResumeCollection = useCallback(async () => {
    if (!journey) return;
    setIsSubmittingReturn(true);
    try {
      const url = isCovering && coverJourneyId
        ? `/api/zmcc/mot/journeys/current/resume-collection?journeyId=${encodeURIComponent(coverJourneyId)}`
        : '/api/zmcc/mot/journeys/current/resume-collection';
      const res = await fetch(url, {
        method: 'POST',
        headers: isCovering ? COVER_HEADERS : undefined,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to resume collection.');
      }
      if (data.journey) {
        setJourney(data.journey);
        await saveCachedJourney(data.journey);
      } else {
        setJourney((prev) => (prev ? { ...prev, status: 'COLLECTING' } : null));
      }
      toast.success('Shop collection resumed.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to resume collection.';
      toast.error(msg);
    } finally {
      setIsSubmittingReturn(false);
    }
  }, [journey, isCovering, coverJourneyId, setJourney]);

  // Authenticate and guard
  useEffect(() => {
    if (loadingUser) return;
    if (!currentUser) {
      router.push('/login');
      return;
    }
    const isMotUser = currentUser.role === 'MOT';
    if (
      (!isMotUser && !canCoverMotWork(currentUser.role)) ||
      (isMotUser &&
        (!currentUser.procurement_source_id ||
          !currentUser.procurement_source ||
          currentUser.procurement_source.is_active === false ||
          currentUser.procurement_source.source_type !== 'ZMCC'))
    ) {
      router.push('/workspace-unavailable');
    }
  }, [loadingUser, currentUser, router]);

  const openDrawer = useCallback(() => setIsDrawerOpen(true), []);
  const closeDrawer = useCallback(() => {
    setIsDrawerOpen(false);
    setTimeout(() => {
      hamburgerButtonRef.current?.focus();
    }, 0);
  }, []);

  if (loadingUser) {
    return (
      <PageLoader label="Loading Mobile Tester…" className="min-h-screen" />
    );
  }

  if (!currentUser) return null;

  return (
    <div className="w-full max-w-full flex flex-col h-screen bg-background text-foreground overflow-hidden">
      <Header
        currentUser={currentUser}
        title="Mobile Tester"
        showBranding={true}
        showMenuButton={true}
        onMenuClick={openDrawer}
        menuButtonRef={hamburgerButtonRef}
      />

      <HierarchicalNavDrawer
        currentUser={currentUser}
        isOpen={isDrawerOpen}
        onClose={closeDrawer}
        triggerButtonRef={hamburgerButtonRef}
      />

      <div className="flex-1 flex overflow-hidden">
        <main className="flex-1 overflow-y-auto p-3 sm:p-5 lg:p-6 w-full max-w-5xl mx-auto space-y-4">
          <PageTransition>
            <SyncBar
              isOnline={isOnline}
              unsyncedCount={sync.unsyncedCount}
              lastSyncTime={sync.lastSyncTime}
              syncFeedback={sync.syncFeedback}
              syncing={sync.syncing}
              onSync={sync.triggerSync}
            />

            {isCovering && (
              <CoveringBanner
                role={currentUser.role}
                isOnline={isOnline}
                coverJourneyId={coverJourneyId}
                coverJourneys={coverJourneys}
                coverListError={coverListError}
                onSelectJourney={selectCoverJourney}
              />
            )}

            {isCovering && (!isOnline || !coverJourneyId) ? null : loadingJourney ? (
              <div className="p-12 text-center text-xs font-semibold text-slate-500 bg-card rounded-xl border border-border">
                <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-primary" />
                Checking assigned route…
              </div>
            ) : journeyError ? (
              <div className="bg-card border-border p-4 border rounded-xl text-rose-800 text-xs font-semibold flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{journeyError}</span>
              </div>
            ) : !journey ? (
              <div className="p-10 bg-card rounded-xl border border-border shadow-2xs text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-blue-50 text-primary flex items-center justify-center mx-auto">
                  <Truck className="w-6 h-6" />
                </div>
                <h2 className="text-base font-semibold text-foreground">No active journey</h2>
                <button
                  type="button"
                  onClick={() => router.refresh()}
                  className="min-h-11 px-4 rounded-xl border border-border text-xs font-semibold text-slate-700 hover:bg-muted"
                >
                  Check again
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <JourneyCard
                  journey={journey}
                  onRecord={collection.handleOpenCollectionModal}
                  onReturnToPhe={() => setReturnModalOpen(true)}
                  onResumeCollection={handleResumeCollection}
                  isSubmittingReturn={isSubmittingReturn}
                />
                <StopsList
                  journey={journey}
                  deviceGps={deviceGps}
                  onRecord={collection.handleOpenCollectionModal}
                  onRequestShop={() => setShopRequestOpen(true)}
                />
              </div>
            )}

            <CollectionModal
              collection={collection}
              currentUser={currentUser}
              journey={journey}
              isCovering={isCovering}
              gpsBadge={gpsBadge}
            />

            {collection.completedReceiptModal && (
              <ReceiptModal
                receipt={collection.completedReceiptModal}
                onClose={() => collection.setCompletedReceiptModal(null)}
                onReturnToPhe={() => setReturnModalOpen(true)}
                hasRemainingStops={Boolean(
                  journey?.stops.some(
                    (s) => s.status !== 'VISITED' && s.status !== 'SKIPPED' && s.status !== 'REJECTED'
                  )
                )}
              />
            )}

            {journey && (
              <ReturnToPheModal
                journey={journey}
                isOpen={returnModalOpen}
                onClose={() => setReturnModalOpen(false)}
                onConfirm={handleReturnToPhe}
                isSubmitting={isSubmittingReturn}
              />
            )}

            {shopRequestOpen && (
              <ShopRequestSheet
                routeId={journey?.route?.id}
                routeName={journey?.route?.name}
                deviceGps={deviceGps}
                gpsBadge={gpsBadge}
                onClose={() => setShopRequestOpen(false)}
              />
            )}
          </PageTransition>
        </main>
      </div>
    </div>
  );
}
