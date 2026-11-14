'use client';

import React, { useState, useEffect, useRef } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';
import { apiClient } from '@/frontend/lib/apiClient';
import { useDebouncedValue } from '@/lib/query/useDebouncedValue';
import { useToast } from '@/frontend/context/ToastContext';
import {
  Scale,
  Lock,
  CheckCircle2,
  Clock,
  Loader2,
  X,
  Search,
  ArrowRight,
  AlertCircle,
  Building2,
} from 'lucide-react';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { formatOperationalDatetime, toDatetimeLocalInput, datetimeLocalToIso } from '@/lib/datetime-utils';
import { useLocalFormDraft } from '@/frontend/hooks/useLocalFormDraft';
import { formatTime } from '@/lib/format';
import { onActivateKey } from '@/lib/a11y';
import { getErrorMessage } from '@/lib/errors';
import { Pager, pageCount, paginate } from './components/Pager';
import { EmptyAction } from './components/EmptyAction';
import { InfoTip } from '@/components/ui/info-tip';
import { SkeletonList } from '@/components/ui/loaders';
import { SegmentedTabs } from '@/components/ui/segmented-tabs';
import {
  UnifiedWeighbridgeVisit,
  WeighbridgeFilter,
  formatDuration,
} from './weighbridgeTypes';

interface WeighbridgeUnifiedStationProps {
  activeTab?: WeighbridgeFilter;
  onTabChange?: (tab: WeighbridgeFilter) => void;
}

export const WeighbridgeUnifiedStation: React.FC<WeighbridgeUnifiedStationProps> = ({
  activeTab: controlledTab,
  onTabChange,
}) => {
  const [internalTab, setInternalTab] = useState<WeighbridgeFilter>('SCALE_ACTION');
  const filter = controlledTab !== undefined ? controlledTab : internalTab;

  const handleFilterChange = (newFilter: WeighbridgeFilter) => {
    setInternalTab(newFilter);
    setPage(1);
    if (onTabChange) onTabChange(newFilter);
  };

  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const debounced = useDebouncedValue(searchQuery);

  const queryClient = useQueryClient();

  const queueQuery = useQuery({
    queryKey: ['weighbridge', 'unified-queue', debounced],
    queryFn: ({ signal }) =>
      fetchJson<{ visits?: UnifiedWeighbridgeVisit[] }>(
        `/api/scale/queue?q=${encodeURIComponent(debounced)}`,
        { signal }
      ),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });

  const allVisits = queueQuery.data?.visits ?? [];

  // Filter lists
  const scaleActionVisits = allVisits.filter((v) => v.is_scale_action_needed && v.accepted_portion_count > 0);
  const atSiloVisits = allVisits.filter((v) => v.active_scale_status === 'AT_SILO');
  const completedVisits = allVisits.filter(
    (v) =>
      v.active_scale_status === 'COMPLETED' ||
      v.active_scale_status === 'REJECTED_EXIT' ||
      v.current_status === 'READY_FOR_GATE_EXIT'
  );

  const filteredVisits =
    filter === 'SCALE_ACTION'
      ? scaleActionVisits
      : filter === 'AT_SILO'
      ? atSiloVisits
      : completedVisits;

  const totalPages = pageCount(filteredVisits.length);
  const currentPage = Math.min(page, totalPages);
  const selectedVisit = allVisits.find((v) => v.id === selectedId) || null;

  return (
    <div className="space-y-5 animate-panel-in">
      {/* Header aligned with Production / Security UI */}
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <Scale className="w-5 h-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold text-foreground">
            Scale queue
          </h1>
          <InfoTip text="Tankers waiting for each weighment." />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold tabular-nums px-3 py-1 rounded-md bg-muted text-foreground border border-border">
            {filter === 'SCALE_ACTION'
              ? `${scaleActionVisits.length} waiting on scale`
              : filter === 'AT_SILO'
              ? `${atSiloVisits.length} at silos`
              : `${completedVisits.length} completed`}
          </span>
        </div>
      </div>


      {/* Search Bar */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setPage(1);
          }}
          placeholder="Search tanker registration or token…"
          className="w-full min-h-11 pl-9 pr-3 py-2 text-sm tabular-nums rounded-xl border border-input bg-card text-foreground focus:outline-hidden focus:ring-2 focus:ring-ring/30 focus:border-primary"
        />
      </div>

      {/* Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {queueQuery.isPending ? (
          <SkeletonList count={3} className="md:col-span-2 lg:col-span-3" />
        ) : filteredVisits.length === 0 ? (
          <EmptyAction
            message={
              filter === 'SCALE_ACTION'
                ? 'No tankers currently waiting on scale'
                : filter === 'AT_SILO'
                ? 'No tankers currently offloading at silos'
                : 'No completed scale tickets found'
            }
            onRefresh={() => queueQuery.refetch()}
            className="md:col-span-2 lg:col-span-3"
          />
        ) : (
          paginate(filteredVisits, currentPage).map((v) => {
            const completedCount = v.steps.filter((s) => s.status === 'COMPLETED').length;

            return (
              <div
                role="button"
                tabIndex={0}
                onKeyDown={onActivateKey}
                key={`unified-card-${v.id}`}
                onClick={() => setSelectedId(v.id)}
                className={`p-4 rounded-xl border transition-colors cursor-pointer space-y-3 min-h-11 bg-card text-foreground ${
                  selectedId === v.id
                    ? 'border-primary'
                    : 'border-border hover:border-border-strong hover:bg-muted/30'
                }`}
              >
                {/* Header: Reg + Token + Status Badge */}
                <div className="flex items-center justify-between gap-2 min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 min-w-0">
                    <span className="font-mono tabular-nums font-semibold text-sm text-foreground">{v.vehicle_number}</span>
                    {v.token_number && (
                      <span className="font-mono tabular-nums text-xs text-muted-foreground shrink-0">
                        ({v.token_number})
                      </span>
                    )}
                  </div>

                  {v.accepted_portion_count === 0 || v.active_scale_status === 'REJECTED_EXIT' ? (
                    <span className="px-2 py-0.5 rounded-md text-xs font-semibold tabular-nums bg-destructive/10 text-destructive border border-destructive/20 shrink-0">
                      Rejected, exit
                    </span>
                  ) : v.active_scale_status === 'READY_FOR_GROSS' ? (
                    <span className="px-2 py-0.5 rounded-md text-xs font-semibold tabular-nums bg-muted text-foreground border border-border shrink-0">
                      Initial gross
                    </span>
                  ) : v.active_scale_status === 'READY_FOR_TARE' ? (
                    <span className="px-2 py-0.5 rounded-md text-xs font-semibold tabular-nums bg-muted text-foreground border border-border shrink-0">
                      Weighment {v.current_weighment_index}/{v.total_weighments}
                    </span>
                  ) : v.active_scale_status === 'AT_SILO' ? (
                    <span className="px-2 py-0.5 rounded-md text-xs font-semibold tabular-nums bg-amber-500/10 text-amber-800 dark:text-amber-300 border border-amber-500/20 shrink-0">
                      At {v.active_silo_text}
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-md text-xs font-semibold tabular-nums bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border border-emerald-500/20 shrink-0">
                      Completed
                    </span>
                  )}
                </div>

                {/* Accepted Portion Count & Indicator */}
                {v.accepted_portion_count === 0 ? (
                  <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-xs text-destructive font-semibold flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>All portions rejected</span>
                    </div>
                    <InfoTip text={`0 of ${v.portion_count} portions accepted. Direct gate exit without scale weighment.`} />
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <span>{v.accepted_portion_count}/{v.portion_count} portions</span>
                        <InfoTip text={`${v.accepted_portion_count} accepted, ${v.rejected_portion_count} rejected. Total ${v.total_weighments} scale weighments required.`} />
                      </div>
                      <span className="tabular-nums font-semibold text-foreground text-xs">
                        Step {completedCount}/{v.total_weighments}
                      </span>
                    </div>
                    {/* Step indicators */}
                    <div className="flex items-center gap-1 w-full">
                      {v.steps.map((st, idx) => {
                        const isDone = st.status === 'COMPLETED';
                        const isActive = st.status === 'ACTIVE_INPUT';
                        return (
                          <div
                            key={`step-dot-${v.id}-${idx}`}
                            className={`h-1.5 flex-1 rounded-full transition-colors ${
                              isDone
                                ? 'bg-foreground'
                                : isActive
                                ? 'bg-foreground/40 ring-1 ring-foreground'
                                : 'bg-muted'
                            }`}
                            title={`${st.label} (${st.status})`}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Current Action / Description */}
                <div className="text-xs font-medium text-foreground bg-muted/60 p-3 rounded-lg flex items-center justify-between border border-border/50">
                  <span className="min-w-0">{v.current_action_label}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0 ml-2" />
                </div>

                {/* Footer: Waiting time & Date */}
                <div className="flex items-center justify-between text-xs tabular-nums text-muted-foreground pt-1 border-t border-border/60 gap-2 min-w-0">
                  <span className="flex items-center gap-1 min-w-0">
                    <Clock className="w-3 h-3 shrink-0" />
                    <span>Waiting: {formatDuration(v.waiting_minutes)}</span>
                  </span>
                  <span className="shrink-0">{v.operational_date}</span>
                </div>
              </div>
            );
          })
        )}
      </div>

      <Pager page={currentPage} totalPages={totalPages} total={filteredVisits.length} onPageChange={setPage} />

      {/* Progressive Stepper Drawer */}
      {selectedVisit && (
        <ProgressiveWeighmentDrawer
          key={selectedVisit.id}
          visit={selectedVisit}
          onClose={() => setSelectedId(null)}
          onSuccess={async () => {
            setSelectedId(null);
            await queryClient.invalidateQueries({ queryKey: ['weighbridge'] });
          }}
        />
      )}
    </div>
  );
};

// =============================================================================
// Progressive Weighment Drawer: Anti-Tamper Non-Editable Stepper
// =============================================================================
interface DrawerProps {
  visit: UnifiedWeighbridgeVisit;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}

const ProgressiveWeighmentDrawer: React.FC<DrawerProps> = ({ visit, onClose, onSuccess }) => {
  const toast = useToast();
  const [activeInputKg, setActiveInputKg] = useState<string>('');
  const [opDateTimeInput, setOpDateTimeInput] = useState<string>(toDatetimeLocalInput(new Date()));
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (visit?.id) {
      setOpDateTimeInput(toDatetimeLocalInput(new Date()));
    }
  }, [visit?.id]);
  const activeWeighOpIdRef = useRef<string | null>(null);

  // Identify currently active step
  const activeStep = visit.steps.find((s) => s.status === 'ACTIVE_INPUT') || null;
  const isGrossStep = activeStep?.stage_type === 'INITIAL_GROSS';

  // What was typed stays on this device until the weighment is recorded.
  const weighDraft = useLocalFormDraft({
    formKey: activeStep ? `weighbridge:${visit.id}:${activeStep.step_index}` : null,
    values: { kg: activeInputKg, time: opDateTimeInput },
    onRestore: (fields) => {
      if (fields.kg !== undefined) setActiveInputKg(fields.kg);
      if (fields.time !== undefined) setOpDateTimeInput(fields.time);
    },
  });

  const enteredVal = Number(activeInputKg);
  const isValidNum = !isNaN(enteredVal) && enteredVal > 0;

  // Real-time Net Weight Calculation Preview
  let previewNetKg: number | null = null;
  if (isValidNum && activeStep?.starting_weight_kg) {
    if (enteredVal < activeStep.starting_weight_kg) {
      previewNetKg = activeStep.starting_weight_kg - enteredVal;
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeStep) {
      toast.showWarning('No scale action is currently pending for this tanker.', 'Not on Scale');
      return;
    }

    if (!isValidNum) {
      toast.showError('Please enter a valid weight scale reading greater than 0 kg.', 'Invalid Weight');
      return;
    }

    // Weight hierarchy check for tares
    if (!isGrossStep && activeStep.starting_weight_kg && enteredVal >= activeStep.starting_weight_kg) {
      toast.showError(
        `Scale reading (${enteredVal.toLocaleString()} kg) must be strictly less than the starting loaded weight (${activeStep.starting_weight_kg.toLocaleString()} kg).`,
        'Weight Hierarchy Error'
      );
      return;
    }

    const isoTimestamp = datetimeLocalToIso(opDateTimeInput);
    if (!isoTimestamp) {
      toast.showError('Please provide a valid operational date and time.', 'Missing Timestamp');
      return;
    }

    let effectiveTimestamp = isoTimestamp;
    if (activeStep.min_allowed_timestamp && new Date(isoTimestamp) < new Date(activeStep.min_allowed_timestamp)) {
      effectiveTimestamp = new Date().toISOString();
      if (new Date(effectiveTimestamp) < new Date(activeStep.min_allowed_timestamp)) {
        effectiveTimestamp = new Date(activeStep.min_allowed_timestamp).toISOString();
      }
    }

    setIsSubmitting(true);
    try {
      if (!activeWeighOpIdRef.current) {
        const prefix = isGrossStep ? 'gross' : `tare-${activeStep.step_index}`;
        activeWeighOpIdRef.current = `wb-${prefix}-${visit.id}-${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Date.now()}`;
      }
      const opId = activeWeighOpIdRef.current;

      if (isGrossStep) {
        // Step 0: Record Initial Gross Weight with in-flight deduplication and timeout
        await apiClient.post(
          '/api/scale/gross-weight',
          {
            visitId: visit.id,
            scaleId: 'SCALE-01',
            grossWeightKg: enteredVal,
            grossTimestamp: effectiveTimestamp,
            clientOperationId: opId,
          },
          {
            dedupKey: `gross-${visit.id}`,
            idempotencyKey: opId,
          }
        );

        toast.showSuccess(
          `Initial Loaded Gross (${enteredVal.toLocaleString()} kg) recorded and locked! Vehicle routed to Silo for Compartment #1.`,
          'Gross Weight Locked'
        );
      } else {
        // Step 1..N: Record Intermediate Tare or Final Tare
        const data = await apiClient.post<{ isPortionCycle?: boolean; completedPortionNumber?: number; nextPortionNumber?: number; data?: { ticket_net_weight_kg?: number } }>(
          '/api/scale/tare-weight',
          {
            visitId: visit.id,
            scaleId: 'SCALE-01',
            tareWeightKg: enteredVal,
            tareTimestamp: effectiveTimestamp,
            clientOperationId: opId,
          },
          {
            dedupKey: `tare-${visit.id}`,
            idempotencyKey: opId,
          }
        );

        if (data.isPortionCycle) {
          toast.showSuccess(
            `Compartment #${data.completedPortionNumber} Tare recorded (${enteredVal.toLocaleString()} kg)! Vehicle ready for Compartment #${data.nextPortionNumber}.`,
            'Intermediate Weighment Locked'
          );
        } else {
          toast.showSuccess(
            `Final Empty Tare (${enteredVal.toLocaleString()} kg) recorded! Total Net Weight: ${data.data?.ticket_net_weight_kg || 'Audited'} kg. Silo receipts finalized.`,
            'Ticket Finalized'
          );
        }
      }

      activeWeighOpIdRef.current = null;
      weighDraft.clear();
      await onSuccess();
    } catch (err) {
      toast.showError(getErrorMessage(err) || 'Failed to record weighment reading', 'Weighbridge Error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Drawer open onOpenChange={(o) => !o && onClose()}>
      <DrawerContent showClose={false}>
        <div className="overflow-y-auto p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:p-6 space-y-6 text-foreground max-w-4xl mx-auto w-full">
          <DrawerTitle className="sr-only">Progressive Scale Weighing</DrawerTitle>

          {/* Drawer Top Header */}
          <div className="flex items-start justify-between gap-3 pb-3 border-b border-border">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <Scale className="w-5 h-5 text-muted-foreground shrink-0" />
                <h3 className="text-base font-semibold text-foreground">
                  {visit.accepted_portion_count === 0
                    ? 'Rejected by QA, gate exit'
                    : `${visit.total_weighments} weighings`}
                </h3>
                <InfoTip
                  label="Weighing guide"
                  text={
                    visit.accepted_portion_count === 0
                      ? 'All compartments rejected by QA. Direct vehicle to Security Gate for exit.'
                      : `1 gross weight + ${visit.accepted_portion_count} tare weight(s) after unloading.`
                  }
                />
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>Tanker: <strong className="font-mono tabular-nums text-foreground">{visit.vehicle_number}</strong></span>
                <span>·</span>
                <span>Token: <strong className="font-mono tabular-nums text-foreground">{visit.token_number || 'NO-TOKEN'}</strong></span>
                <span>·</span>
                <span>
                  Portions: <strong className="text-foreground">{visit.accepted_portion_count} of {visit.portion_count} accepted</strong>
                </span>
                {visit.rejected_portion_count > 0 && (
                  <span className="text-destructive font-semibold">({visit.rejected_portion_count} rejected)</span>
                )}
              </div>
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground shrink-0 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* QA Total Rejection Notice */}
          {visit.accepted_portion_count === 0 && (
            <div className="flex items-center justify-between p-3 bg-destructive/10 rounded-xl border border-destructive/20 text-xs text-destructive font-medium">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span className="font-semibold">All rejected by QA, send to security gate</span>
              </div>
              <InfoTip
                text={`All ${visit.portion_count} compartments rejected by QA. Direct vehicle to Security Gate for exit.`}
              />
            </div>
          )}

          {/* Partial QA Rejection Notice */}
          {visit.accepted_portion_count > 0 && visit.rejected_portion_count > 0 && (
            <div className="flex items-center justify-between p-3 bg-amber-500/10 rounded-xl border border-amber-500/20 text-xs text-amber-800 dark:text-amber-300 font-medium">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Compartment #{visit.rejected_portion_numbers?.join(', #')} rejected</span>
              </div>
              <InfoTip
                text={`Compartment #${visit.rejected_portion_numbers?.join(', #')} was rejected by QA and is blocked from silo offloading and scale tares. Only the ${visit.accepted_portion_count} accepted compartments are weighed.`}
              />
            </div>
          )}

          {/* Stepper Timeline: All N+1 Boxes */}
          {visit.accepted_portion_count > 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <h4 className="text-xs font-semibold text-muted-foreground">
                  Weighment progress ({visit.total_weighments} readings)
                </h4>
                <InfoTip
                  text="Finished steps are locked. Later steps open after silo transfer."
                />
              </div>

              <div className="space-y-3">
                {visit.steps.map((step) => {
                  const isLocked = step.is_locked;
                  const isActive = step.status === 'ACTIVE_INPUT';

                  if (isLocked) {
                    // LOCKED / NON-CLICKABLE BOX (Audit-Frozen Past Weight)
                    return (
                      <div
                        key={`box-locked-${step.step_index}`}
                        className="p-4 rounded-2xl border border-border/80 bg-muted/20 space-y-2 select-none"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2 font-semibold text-foreground">
                            <Lock className="w-3.5 h-3.5 text-muted-foreground" />
                            <span>
                              Step {step.step_number} of {visit.total_weighments} · {step.label}
                            </span>
                          </div>
                          <span className="px-2 py-0.5 rounded text-xs font-semibold tabular-nums bg-emerald-500/10 text-emerald-800 border border-emerald-500/20 dark:text-emerald-300 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            Locked
                          </span>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-xs">
                          <div className="bg-card p-2 rounded-lg border border-border/50">
                            <span className="text-xs text-muted-foreground block font-medium">Recorded weight</span>
                            <span className="font-mono text-base font-semibold tabular-nums text-foreground">
                              {step.recorded_weight_kg?.toLocaleString()} kg
                            </span>
                          </div>

                          {step.net_weight_kg !== null && (
                            <div className="bg-card p-2 rounded-lg border border-border/50">
                              <span className="text-xs text-muted-foreground block font-medium">Compartment net</span>
                              <span className="font-mono text-base font-semibold tabular-nums text-foreground">
                                {step.net_weight_kg?.toLocaleString()} kg
                              </span>
                            </div>
                          )}

                          {step.destination_silo && (
                            <div className="bg-card p-2 rounded-lg border border-border/50">
                              <span className="text-xs text-muted-foreground block font-medium">Offloaded into</span>
                              <span className="text-xs font-semibold text-foreground">{step.destination_silo}</span>
                            </div>
                          )}

                          <div className="bg-card p-2 rounded-lg border border-border/50">
                            <span className="text-xs text-muted-foreground block font-medium">Weighed at</span>
                            <span className="text-xs tabular-nums text-foreground">
                              {step.timestamp
                                ? formatTime(step.timestamp)
                                : '-'}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  if (isActive) {
                    // ACTIVE INPUT BOX (Current Physical Weighment on Scale)
                    return (
                      <form
                        key={`box-active-${step.step_index}`}
                        onSubmit={handleSubmit}
                        className="p-4 rounded-2xl border-2 border-primary bg-primary/[0.03] shadow-xs space-y-4"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 font-semibold text-primary text-sm">
                            <Scale className="w-4 h-4" />
                            <span>
                              Step {step.step_number} of {visit.total_weighments} · {step.label}
                            </span>
                          </div>
                          <span className="px-2 py-0.5 rounded text-xs font-semibold tabular-nums bg-primary text-primary-foreground">
                            Active
                          </span>
                        </div>

                        {/* Reference for Tares */}
                        {step.starting_weight_kg !== null && (
                          <div className="p-3 rounded-lg bg-card border border-border text-xs flex items-center justify-between">
                            <span className="text-muted-foreground font-medium">
                              Starting loaded weight
                            </span>
                            <span className="font-mono text-base font-semibold tabular-nums text-foreground">
                              {step.starting_weight_kg.toLocaleString()} kg
                            </span>
                          </div>
                        )}

                        {/* Numeric Scale Input */}
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            <label className="text-xs font-semibold text-foreground block">
                              Scale reading (kg) *
                            </label>
                            <InfoTip
                              text={
                                isGrossStep
                                  ? 'Capture the scale indicator for the fully loaded tanker upon plant arrival.'
                                  : `Scale reading must be less than ${step.starting_weight_kg?.toLocaleString()} kg.`
                              }
                            />
                          </div>
                          <div className="relative">
                            <input
                              type="number"
                              inputMode="decimal"
                              autoFocus
                              step="1"
                              min="1"
                              value={activeInputKg}
                              onChange={(e) => setActiveInputKg(e.target.value)}
                              placeholder="Scale reading in kg"
                              className="w-full min-h-12 px-4 py-2 font-mono text-2xl font-semibold tabular-nums rounded-xl border-2 border-input bg-card text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/40 focus:border-primary"
                            />
                            <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">
                              KG
                            </span>
                          </div>
                        </div>

                        {/* Real-Time Net Preview */}
                        {previewNetKg !== null && (
                          <div className="p-3 bg-emerald-500/10 rounded-xl border border-emerald-500/20 text-xs text-emerald-800 dark:text-emerald-300 flex items-center justify-between font-medium">
                            <span>Net weight</span>
                            <span className="font-mono text-lg font-semibold tabular-nums">
                              {previewNetKg.toLocaleString()} kg
                            </span>
                          </div>
                        )}

                        {/* time */}
                        <div className="space-y-1">
                          <label className="text-xs font-semibold text-muted-foreground block">
                            Date and time
                          </label>
                          <input
                            type="datetime-local"
                            value={opDateTimeInput}
                            min={activeStep?.min_allowed_timestamp ? toDatetimeLocalInput(activeStep.min_allowed_timestamp) : undefined}
                            onChange={(e) => setOpDateTimeInput(e.target.value)}
                            className="w-full min-h-11 px-3 py-2 text-sm tabular-nums rounded-lg border border-input bg-card text-foreground"
                          />
                          {activeStep?.min_allowed_timestamp && (
                            <p className="text-xs text-muted-foreground tabular-nums">
                              Earliest allowed: {formatOperationalDatetime(activeStep.min_allowed_timestamp)}
                            </p>
                          )}
                        </div>

                        {/* Submit Action */}
                        <button
                          type="submit"
                          disabled={isSubmitting || !isValidNum}
                          className="w-full min-h-11 px-4 py-2 rounded-xl font-semibold text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
                        >
                          {isSubmitting ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Recording…
                            </>
                          ) : (
                            <>
                              <Lock className="w-4 h-4" />
                              Record step {step.step_number} of {visit.total_weighments}
                            </>
                          )}
                        </button>
                      </form>
                    );
                  }

                  // PENDING FUTURE BOX (Waiting for Silo Unloading)
                  return (
                    <div
                      key={`box-pending-${step.step_index}`}
                      className="p-4 rounded-2xl border border-dashed border-border/60 bg-muted/10 opacity-70 space-y-1 select-none"
                    >
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <div className="flex items-center gap-2 font-medium">
                          <Clock className="w-3.5 h-3.5" />
                          <span>
                            Step {step.step_number} of {visit.total_weighments} · {step.label}
                          </span>
                          <InfoTip
                            text={`Unlocks after Compartment #${step.portion_number} completes offloading at the silo.`}
                          />
                        </div>
                        <span className="text-xs font-semibold text-muted-foreground">
                          Waiting for silo unload
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
};
