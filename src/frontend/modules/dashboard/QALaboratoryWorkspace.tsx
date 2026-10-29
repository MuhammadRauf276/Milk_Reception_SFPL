'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';
import { useDebouncedValue } from '@/lib/query/useDebouncedValue';
import { User } from '@core/types';

import {
  QAQueuePanel,
  WaitingVisit,
  InTestingVisit,
  OnHoldVisit,
} from './qa/QAQueuePanel';
import {
  QATestingSection,
  TestPerformanceStatus,
  LabTestDef,
  SavedPlantResult,
  VisitDetailPortion,
  VisitDetail,
  TestInputState,
} from './qa/QATestingSection';
import { QADecisionModals } from './qa/QADecisionModals';
import { useQAVisitDetail } from './qa/useQAVisitDetail';
import { useQAActions } from './qa/useQAActions';
import { PageHeader } from '@/components/ui/page-header';

export type {
  WaitingVisit,
  InTestingVisit,
  OnHoldVisit,
  TestPerformanceStatus,
  LabTestDef,
  SavedPlantResult,
  VisitDetailPortion,
  VisitDetail,
  TestInputState,
};

export type QATab = 'WAITING' | 'IN_TESTING' | 'ON_HOLD';

interface QALaboratoryWorkspaceProps {
  currentUser?: User | null;
  activeTab?: QATab;
  onTabChange?: (tab: QATab) => void;
}

export const QALaboratoryWorkspace: React.FC<QALaboratoryWorkspaceProps> = ({
  currentUser,
  activeTab: controlledTab,
  onTabChange,
}) => {
  const [internalTab, setInternalTab] = useState<QATab>('WAITING');
  const activeTab = controlledTab !== undefined ? controlledTab : internalTab;

  const setActiveTab = (tab: QATab) => {
    setInternalTab(tab);
    if (onTabChange) onTabChange(tab);
  };
  const [searchQuery, setSearchQuery] = useState('');

  // Tab-Specific Selection States
  const [selectedWaitingVisitId, setSelectedWaitingVisitId] = useState<string | null>(null);
  const [selectedTestingVisitId, setSelectedTestingVisitId] = useState<string | null>(null);
  const [selectedHeldVisitId, setSelectedHeldVisitId] = useState<string | null>(null);
  const isSuperior = ['QA_HEAD', 'SUPER_ADMIN'].includes(currentUser?.role || '');

  const queryClient = useQueryClient();
  const debouncedSearch = useDebouncedValue(searchQuery);
  const queuesQuery = useQuery({
    queryKey: ['qa', 'queues', debouncedSearch],
    queryFn: ({ signal }) =>
      fetchJson<{ waiting?: WaitingVisit[]; inTesting?: InTestingVisit[]; onHold?: OnHoldVisit[] }>(
        `/api/qa/sessions/queues?q=${encodeURIComponent(debouncedSearch)}`,
        { signal }
      ),
    placeholderData: keepPreviousData,
    // Live board: 30s refresh, paused while the tab is hidden.
    refetchInterval: 30_000,
  });
  const waitingVisits = useMemo(() => queuesQuery.data?.waiting ?? [], [queuesQuery.data]);
  const inTestingVisits = useMemo(() => queuesQuery.data?.inTesting ?? [], [queuesQuery.data]);
  const onHoldVisits = useMemo(() => queuesQuery.data?.onHold ?? [], [queuesQuery.data]);
  const isLoadingQueues = queuesQuery.isPending;
  const fetchQueues = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['qa', 'queues'] }),
    [queryClient]
  );

  useEffect(() => {
    if (!queuesQuery.data) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedWaitingVisitId((prev) =>
      prev && waitingVisits.some((v) => v.id === prev) ? prev : waitingVisits.length > 0 ? waitingVisits[0].id : null
    );
    setSelectedTestingVisitId((prev) =>
      prev && inTestingVisits.some((v) => v.id === prev) ? prev : inTestingVisits.length > 0 ? inTestingVisits[0].id : null
    );
    setSelectedHeldVisitId((prev) =>
      prev && onHoldVisits.some((v) => v.id === prev) ? prev : onHoldVisits.length > 0 ? onHoldVisits[0].id : null
    );
  }, [queuesQuery.data, waitingVisits, inTestingVisits, onHoldVisits]);

  const selectedWaitingVisit = useMemo(
    () => waitingVisits.find((v) => v.id === selectedWaitingVisitId) || null,
    [waitingVisits, selectedWaitingVisitId]
  );

  const selectedHeldVisit = useMemo(
    () => onHoldVisits.find((v) => v.id === selectedHeldVisitId) || null,
    [onHoldVisits, selectedHeldVisitId]
  );

  const detail = useQAVisitDetail(selectedTestingVisitId);
  const actions = useQAActions({
    detail,
    selectedWaitingVisitId,
    selectedHeldVisitId,
    setSelectedTestingVisitId,
    setSelectedHeldVisitId,
    setActiveTab,
    fetchQueues,
  });
  const { visitDetail, activePortion } = detail;

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6 text-foreground">
      <PageHeader
        title={
          activeTab === 'WAITING'
            ? 'Waiting'
            : activeTab === 'IN_TESTING'
            ? 'In testing'
            : 'On hold'
        }
        description={
          activeTab === 'WAITING'
            ? 'Awaiting sampling'
            : activeTab === 'IN_TESTING'
            ? 'Active tests'
            : 'Held portions'
        }
      />

      <nav aria-label="QA Laboratory queues" className="grid grid-cols-3 gap-2 lg:hidden">
        <button
          type="button"
          aria-current={activeTab === 'WAITING' ? 'page' : undefined}
          onClick={() => setActiveTab('WAITING')}
          className={`min-h-11 rounded-xl border text-xs sm:text-sm font-semibold transition flex items-center justify-center gap-1.5 ${
            activeTab === 'WAITING'
              ? 'border-primary ring-1 ring-primary bg-primary/5 text-primary font-bold'
              : 'border-border bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          <span>Waiting</span>
          <span className="tabular-nums px-1.5 py-0.5 rounded-full text-[11px] bg-slate-100 text-slate-700">
            {waitingVisits.length}
          </span>
        </button>

        <button
          type="button"
          aria-current={activeTab === 'IN_TESTING' ? 'page' : undefined}
          onClick={() => setActiveTab('IN_TESTING')}
          className={`min-h-11 rounded-xl border text-xs sm:text-sm font-semibold transition flex items-center justify-center gap-1.5 ${
            activeTab === 'IN_TESTING'
              ? 'border-primary ring-1 ring-primary bg-primary/5 text-primary font-bold'
              : 'border-border bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          <span>In Testing</span>
          <span className="tabular-nums px-1.5 py-0.5 rounded-full text-[11px] bg-sky-100 text-sky-800">
            {inTestingVisits.length}
          </span>
        </button>

        <button
          type="button"
          aria-current={activeTab === 'ON_HOLD' ? 'page' : undefined}
          onClick={() => setActiveTab('ON_HOLD')}
          className={`min-h-11 rounded-xl border text-xs sm:text-sm font-semibold transition flex items-center justify-center gap-1.5 ${
            activeTab === 'ON_HOLD'
              ? 'border-primary ring-1 ring-primary bg-primary/5 text-primary font-bold'
              : 'border-border bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          <span>On Hold</span>
          <span className="tabular-nums px-1.5 py-0.5 rounded-full text-[11px] bg-amber-100 text-amber-900">
            {onHoldVisits.length}
          </span>
        </button>
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-5">
          <QAQueuePanel
            activeTab={activeTab}
            searchQuery={searchQuery}
            onSearchChange={(q) => {
              setSearchQuery(q);
            }}
            waitingVisits={waitingVisits}
            inTestingVisits={inTestingVisits}
            onHoldVisits={onHoldVisits}
            selectedWaitingVisitId={selectedWaitingVisitId}
            selectedTestingVisitId={selectedTestingVisitId}
            selectedHeldVisitId={selectedHeldVisitId}
            onSelectWaitingVisit={(id) => setSelectedWaitingVisitId(id)}
            onSelectTestingVisit={(id) => setSelectedTestingVisitId(id)}
            onSelectHeldVisit={(id) => setSelectedHeldVisitId(id)}
            onOpenActionModal={actions.openActionModal}
            isLoadingQueues={isLoadingQueues}
            isSubmitting={actions.isSubmitting}
          />
        </div>

        <div key={activeTab} className="lg:col-span-7 animate-panel-in">
          <QATestingSection
            activeTab={activeTab}
            searchQuery={searchQuery}
            selectedWaitingVisit={selectedWaitingVisit}
            selectedHeldVisit={selectedHeldVisit}
            visitDetail={visitDetail}
            activePortionIndex={detail.activePortionIndex}
            onSelectPortion={detail.handleSelectPortion}
            isLoadingVisit={detail.isLoadingVisit}
            testInputs={detail.testInputs}
            onTestPerformanceStatusChange={detail.handleTestPerformanceStatusChange}
            onTestNumericChange={detail.handleTestNumericChange}
            onTestTextChange={detail.handleTestTextChange}
            onTestReasonChange={detail.handleTestReasonChange}
            onOpenActionModal={actions.openActionModal}
            requiredManualPlantTests={detail.requiredManualPlantTests}
            performedCount={detail.performedCount}
            notPerformedCount={detail.notPerformedCount}
            unresolvedCount={detail.unresolvedCount}
            canAccept={detail.canAccept}
            isSubmitting={actions.isSubmitting}
            formatDispatchQty={detail.formatDispatchQty}
            onAddPortion={actions.handleAddPortion}
            isAddingPortion={actions.isAddingPortion}
            onRemovePortion={actions.handleRemovePortion}
            isRemovingPortion={actions.isRemovingPortion}
            enteredSeal={
              activePortion
                ? detail.enteredSealMap[activePortion.id] ?? (activePortion.plant_seal_number_entered || '')
                : ''
            }
            onSealChange={(val) => {
              if (activePortion) {
                detail.setEnteredSealMap((prev) => ({ ...prev, [activePortion.id]: val }));
              }
            }}
            photoStates={activePortion ? detail.photoStatesMap[activePortion.id] || {} : {}}
            onPhotoChange={(testId, url) => {
              if (activePortion) {
                detail.setPhotoStatesMap((prev) => {
                  const portionMap = { ...(prev[activePortion.id] || {}) };
                  if (url) {
                    portionMap[testId] = url;
                  } else {
                    delete portionMap[testId];
                  }
                  return { ...prev, [activePortion.id]: portionMap };
                });
              }
            }}
            personDecision={activePortion ? detail.personDecisionMap[activePortion.id] || null : null}
            onPersonDecisionChange={(d) => {
              if (activePortion) {
                detail.setPersonDecisionMap((prev) => ({ ...prev, [activePortion.id]: d }));
              }
            }}
            decisionRemarks={activePortion ? detail.decisionRemarksMap[activePortion.id] || '' : ''}
            onDecisionRemarksChange={(r) => {
              if (activePortion) {
                detail.setDecisionRemarksMap((prev) => ({ ...prev, [activePortion.id]: r }));
              }
            }}
            isSuperior={isSuperior}
            currentUser={currentUser}
            onAcceptSubmit={() => actions.handleAcceptPortionConfirm()}
            onRejectSubmit={() => actions.handleRejectPortionConfirm()}
            onRouteVehicle={actions.handleRouteVehicle}
            isRoutingVehicle={actions.isRoutingVehicle}
          />
        </div>
      </div>

      <QADecisionModals
        activeActionModal={actions.activeActionModal}
        onCloseModal={() => actions.setActiveActionModal(null)}
        actionVisitId={actions.actionVisitId}
        visitDetail={visitDetail}
        activePortionIndex={detail.activePortionIndex}
        qaOpTimestamp={actions.qaOpTimestamp}
        onQaOpTimestampChange={(val) => actions.setQaOpTimestamp(val)}
        rejectionReason={actions.rejectionReason}
        onRejectionReasonChange={(val) => actions.setRejectionReason(val)}
        rejectionRemarks={actions.rejectionRemarks}
        onRejectionRemarksChange={(val) => actions.setRejectionRemarks(val)}
        exceptionReason={actions.exceptionReason}
        onExceptionReasonChange={(val) => actions.setExceptionReason(val)}
        hasFailingTests={detail.hasFailingTests}
        onStartTestingConfirm={actions.handleStartTesting}
        onResumeTestingConfirm={actions.handleResumeTesting}
        onAcceptPortionConfirm={actions.handleAcceptPortionConfirm}
        onRejectPortionConfirm={actions.handleRejectPortionConfirm}
        isSubmitting={actions.isSubmitting}
        waitingVisits={waitingVisits}
        onHoldVisits={onHoldVisits}
      />
    </div>
  );
};
