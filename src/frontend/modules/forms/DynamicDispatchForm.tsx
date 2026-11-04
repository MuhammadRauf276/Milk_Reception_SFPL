'use client';

import React, { useState, useEffect, useRef, useEffectEvent, useMemo } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Loader2, Send, Undo2, XCircle } from 'lucide-react';
import { toDatetimeLocalInput, datetimeLocalToIso } from '@/lib/datetime-utils';
import { useToast } from '@/frontend/context/ToastContext';
import { User } from '@core/types';
import { getScopedDraftKey } from '@/lib/validations/dispatch';

import {
  QuantityUnit,
  MeasurementBasis,
  getAllowedUnits,
  getAllowedBases,
  DEFAULT_DISPATCH_QUANTITY_POLICY,
  type DispatchQuantityPolicySnapshotDTO,
} from '@/backend/modules/dispatch/quantity-policy/types';
import {
  applySharedPortionUnit,
  applySharedPortionBasis,
  createPortionQuantityFromSharedProfile,
  computeDispatchPortionCalculatedValues,
  computePortionQuantitySummary,
  computeVehiclePortionDifference,
  computeDispatchSafeSummaryTotals,
} from '@/backend/modules/dispatch/quantity/dispatchQuantityService';

import {
  DispatchVehicleSection,
  QuantityUnitType,
  MeasurementBasisType,
  QuantityState,
} from './components/DispatchVehicleSection';
import {
  DispatchPortionEditor,
  getDuplicateSealMessage,
  LabTestDef,
  TestResultState,
  PortionFormState,
} from './components/DispatchPortionEditor';
import { DispatchSummaryPanel } from './components/DispatchSummaryPanel';
import { toPhotoState, type DispatchPhotoState } from './components/DispatchPolicyTests';
import { calculatedValuesForPortion } from '@/lib/portion-calculated-values';
import { useServerDraft, type DraftFormType } from '@/frontend/hooks/useServerDraft';
import { applyDraftToExtras, applyDraftToPortions, dispatchDraftFromForm } from '@/lib/dispatch-draft';
import { isCalculatedTest } from '@/lib/lab-test-roles';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { LabReportPhotoCard } from './components/LabReportPhotoCard';
import { DecisionRulePanel, exceptionReasonText } from '@/frontend/modules/shared/decision/DecisionRulePanel';
import { cn } from '@/lib/utils';
import {
  buildDispatchPreview,
  LAB_REPORT_TEST_CODE,
  type DispatchPolicySnapshot,
  isNumericTest,
  type DispatchPolicyTest,
  type DispatchTestMode,
} from './dispatchDecisionPreview';
import type { LiveCameraResult } from '@/types/captured-photo';
import type { DecisionResult, PersonDecision } from '@/types/stage1-decision';
import { getErrorMessage } from '@/lib/errors';

export type { QuantityUnitType, MeasurementBasisType, QuantityState, LabTestDef, TestResultState, PortionFormState };

interface DynamicDispatchFormProps {
  currentUser: User | null;
  onSuccess?: () => void;
  sourceType?: 'ZMCC' | 'CONTRACTOR';
}

/** Vehicle LR & Fat from the portions: quantity-weighted average, else a simple average, else ''. */
function computeAutoVehicleQuality(
  portions: PortionFormState[],
  labTests: LabTestDef[],
  policyTests: DispatchPolicyTest[]
): { lr: string; fat: string } {
  // LR and Fat are the policy tests the server flagged (by stored role), never found by name text.
  const lrId = policyTests.find((t) => t.isLr)?.labTestId;
  const fatId = policyTests.find((t) => t.isFat)?.labTestId;
  const lrTest = lrId ? labTests.find((t) => t.testId === lrId) : undefined;
  const fatTest = fatId ? labTests.find((t) => t.testId === fatId) : undefined;

  let totalQty = 0;
  let weightedLrSum = 0;
  let weightedFatSum = 0;
  let simpleLrSum = 0;
  let simpleFatSum = 0;
  let validLrCount = 0;
  let validFatCount = 0;

  portions.forEach((p) => {
    const qty = parseFloat(p.quantity.value) || 0;
    const lrRes = lrTest ? p.results[lrTest.testId] : null;
    const fatRes = fatTest ? p.results[fatTest.testId] : null;

    const lrVal = lrRes && lrRes.performanceStatus === 'PERFORMED' && lrRes.numericValue !== ''
      ? parseFloat(lrRes.numericValue)
      : null;
    const fatVal = fatRes && fatRes.performanceStatus === 'PERFORMED' && fatRes.numericValue !== ''
      ? parseFloat(fatRes.numericValue)
      : null;

    if (lrVal !== null && !isNaN(lrVal)) {
      simpleLrSum += lrVal;
      validLrCount++;
      if (qty > 0) {
        weightedLrSum += qty * lrVal;
      }
    }

    if (fatVal !== null && !isNaN(fatVal)) {
      simpleFatSum += fatVal;
      validFatCount++;
      if (qty > 0) {
        weightedFatSum += qty * fatVal;
      }
    }

    if (qty > 0) {
      totalQty += qty;
    }
  });

  const isSingle = portions.length === 1;
  const lr =
    totalQty > 0 && weightedLrSum > 0
      ? (weightedLrSum / totalQty).toFixed(2)
      : isSingle && validLrCount === 1
        ? (simpleLrSum).toFixed(2)
        : '';
  const fat =
    totalQty > 0 && weightedFatSum > 0
      ? (weightedFatSum / totalQty).toFixed(2)
      : isSingle && validFatCount === 1
        ? (simpleFatSum).toFixed(2)
        : '';
  return { lr, fat };
}

interface StartedDispatchWorkItem {
  visitId: string;
  assignedTests?: LabTestDef[];
  quantityPolicy?: DispatchQuantityPolicySnapshotDTO | null;
}

/**
 * Resumes the draft saved for this user/source (unless forceNew) or starts a new dispatch
 * work item. A stale saved draft (404/400/403) is dropped and a fresh one is created.
 */
async function startDispatchWorkItem(
  targetSourceId: string,
  scopedKey: string | null,
  forceNew: boolean
): Promise<StartedDispatchWorkItem> {
  const savedDraftId = !forceNew && scopedKey && typeof window !== 'undefined'
    ? sessionStorage.getItem(scopedKey)
    : null;

  // Silent stale draft resumption: if resuming an existing draft fails for ANY reason,
  // purge the stale draft key immediately and gracefully create a fresh work item.
  if (savedDraftId) {
    try {
      const res = await fetch('/api/dispatches/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitId: savedDraftId,
          procurementSourceId: targetSourceId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.visitId) {
        return data as StartedDispatchWorkItem;
      }
      if (scopedKey && typeof window !== 'undefined') {
        sessionStorage.removeItem(scopedKey);
      }
    } catch {
      if (scopedKey && typeof window !== 'undefined') {
        sessionStorage.removeItem(scopedKey);
      }
    }
  }

  // Create clean fresh draft
  const res = await fetch('/api/dispatches/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      procurementSourceId: targetSourceId,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Failed to start dispatch work item');
  }
  return data as StartedDispatchWorkItem;
}

interface DispatchTotals {
  grossLiters: number;
  weightedLr: number;
  weightedFat: number;
  weightedTs13: number;
}

interface DispatchResultView {
  dispatchNumber: string;
  status: string;
  totals: DispatchTotals | null;
  tankRemainingLiters: number | null;
  decision: DecisionResult | null;
  approverLabel: string;
}

interface PendingUpload {
  key: string;
  label: string;
  photo: DispatchPhotoState;
  entityType: 'dispatch_portion' | 'dispatch_info';
  entityId: string;
  labTestId: string | null;
  portionNumber: number | null;
  photoKind: 'TEST_RESULT' | 'LAB_REPORT';
  testingPoint: string;
  policyVersion: number | null;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(v: unknown): UnknownRecord {
  return v && typeof v === 'object' ? (v as UnknownRecord) : {};
}

function pickString(o: UnknownRecord, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v) return v;
    if (typeof v === 'number') return String(v);
  }
  return null;
}

function isFilled(portion: PortionFormState, t: DispatchPolicyTest): boolean {
  const r = portion.results[t.labTestId];
  if (!r) return false;
  return isNumericTest(t) ? r.numericValue !== '' && !isNaN(Number(r.numericValue)) : r.textValue.trim().length > 0;
}

const STATUS_VIEW: Record<string, { word: string; className: string; Icon: typeof CheckCircle2 }> = {
  DISPATCHED: { word: 'Dispatched', className: 'border-emerald-300 bg-emerald-50 text-emerald-800', Icon: CheckCircle2 },
  PENDING_APPROVAL: { word: 'Waiting for approval', className: 'border-violet-300 bg-violet-50 text-violet-900', Icon: Clock },
  REOPENED: { word: 'Sent back to you', className: 'border-amber-300 bg-amber-50 text-amber-900', Icon: AlertTriangle },
  REJECTED: { word: 'Rejected', className: 'border-rose-300 bg-rose-50 text-rose-800', Icon: XCircle },
};

function fmtL(n: number | null | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? `${Math.round(n).toLocaleString()} L` : '—';
}

function fmt2(n: number | null | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? n.toFixed(2) : '—';
}

export const DynamicDispatchForm: React.FC<DynamicDispatchFormProps> = ({ currentUser, onSuccess, sourceType }) => {
  const toast = useToast();
  const [policy, setPolicy] = useState<DispatchPolicySnapshot | null>(null);
  const [policyLoadedFor, setPolicyLoadedFor] = useState<string | null>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [testMode, setTestMode] = useState<DispatchTestMode>('COMPOSITE');
  const [formStep, setFormStep] = useState<0 | 1>(0);
  const [decideOpen, setDecideOpen] = useState(false);
  const [showWhy, setShowWhy] = useState(false);
  const [labReportPhoto, setLabReportPhoto] = useState<DispatchPhotoState | null>(null);
  const [labReportCamera, setLabReportCamera] = useState(false);
  const [personDecision, setPersonDecision] = useState<PersonDecision | null>(null);
  const [decisionRemarks, setDecisionRemarks] = useState('');
  const [needsRequest, setNeedsRequest] = useState<DecisionResult | null>(null);
  const [sealServerError, setSealServerError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [reopenedNote, setReopenedNote] = useState<string | null>(null);
  const [result, setResult] = useState<DispatchResultView | null>(null);
  const [uploadQueue, setUploadQueue] = useState<PendingUpload[]>([]);
  const [uploading, setUploading] = useState(false);
  const meCode = (currentUser as (User & { employee_code?: string }) | null)?.employee_code || currentUser?.username || 'unknown';
  const [restartingWorkItem, setRestartingWorkItem] = useState(false);

  const [availableSources, setAvailableSources] = useState<Array<{ id: string; name: string; source_type: string }>>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string>('');
  const [frozenQuantityPolicy, setFrozenQuantityPolicy] = useState<DispatchQuantityPolicySnapshotDTO | null>(null);

  // Vehicle Header Fields
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [vehicleNumberError, setVehicleNumberError] = useState<string | null>(null);
  const [dispatchOpDatetime, setDispatchOpDatetime] = useState<string>(toDatetimeLocalInput(new Date()));
  const [rawMilkDispatchNoteNumber, setRawMilkDispatchNoteNumber] = useState<string>('');

  // ZMCC & Contractor Resource States
  const [availableVehicles, setAvailableVehicles] = useState<Array<{ id: string; vehicle_number: string; is_available: boolean; busy_reason?: string }>>([]);
  const [availableMotProfiles, setAvailableMotProfiles] = useState<Array<{ id: string; mot_code: string; name: string; phone_number: string; is_available: boolean; busy_reason?: string }>>([]);
  const [selectedMotVehicleId, setSelectedMotVehicleId] = useState<string>('');
  const [selectedMotProfileId, setSelectedMotProfileId] = useState<string>('');
  const [motError, setMotError] = useState<string | null>(null);
  const [driverName, setDriverName] = useState<string>('');
  const [driverError, setDriverError] = useState<string | null>(null);
  const [isLoadingResources, setIsLoadingResources] = useState<boolean>(false);

  // Authoritative Vehicle Quantity State
  const [vehicleQuantity, setVehicleQuantity] = useState<QuantityState>({
    value: '',
    unit: 'KG',
    basis: 'MEASURED',
  });
  const [vehicleQuantityError, setVehicleQuantityError] = useState<string | null>(null);
  const [manualVehicleLr, setVehicleLr] = useState<string>('');
  const [manualVehicleFat, setVehicleFat] = useState<string>('');
  const [isVehicleQualityAuto, setIsVehicleQualityAuto] = useState<boolean>(true);
  const [dispatchTestingRemarks, setDispatchTestingRemarks] = useState<string>('');

  // Portions Draft State
  const [portions, setPortions] = useState<PortionFormState[]>([]);
  const [editingPortionIndex, setEditingPortionIndex] = useState<number | null>(null);

  // Per-portion inline errors state
  const [portionErrors, setPortionErrors] = useState<
    Record<number, { quantity?: string; seal?: string; tests?: Record<string, string> }>
  >({});

  const [isSubmitting, setIsSubmitting] = useState(false);

  // Determine user procurement source
  const userSource = currentUser?.procurement_source || null;
  const isSourceBound = !!currentUser?.procurement_source_id && !!userSource;
  const effectiveSource = isSourceBound
    ? userSource
    : availableSources.find((s) => s.id === selectedSourceId) || null;

  const effectiveSourceId = isSourceBound
    ? (userSource?.id ? String(userSource.id) : '')
    : selectedSourceId;

  const isContractorSource = sourceType === 'CONTRACTOR' || effectiveSource?.source_type === 'CONTRACTOR';
  const policyPoint: DispatchPolicySnapshot['point'] | null = sourceType === 'CONTRACTOR'
    ? 'CONTRACTOR_DISPATCH'
    : effectiveSource
      ? isContractorSource
        ? 'CONTRACTOR_DISPATCH'
        : 'ZMCC_DISPATCH'
      : null;
  const approverLabel = isContractorSource ? 'Contractor Manager' : 'Zonal Manager';
  const roleLabel = currentUser?.role ?? 'unknown';
  // Preview only: the server decides again. Superiors decide on the same screen; Super Admin does everything below it.
  const deciderCanApprove = roleLabel === 'SUPER_ADMIN' || (isContractorSource
    ? roleLabel === 'CONTRACTOR_MANAGER' || roleLabel === 'HEAD_OF_MPD'
    : roleLabel === 'ZMCC_MANAGER' || roleLabel === 'HEAD_OF_MPD');

  const policyTests = useMemo<DispatchPolicyTest[]>(
    () => (policy?.tests ?? []).filter((t) => t.testMode !== 'OFF' && t.testCode !== LAB_REPORT_TEST_CODE),
    [policy]
  );
  const labReportTest = useMemo(() => (policy?.tests ?? []).find((t) => t.testCode === LAB_REPORT_TEST_CODE) ?? null, [policy]);
  // The shared helpers (summary, vehicle quality) read tests as LabTestDef; they come from the policy now.
  const labTests = useMemo<LabTestDef[]>(
    () =>
      policyTests.map((t, i) => ({
        id: t.labTestId,
        testId: t.labTestId,
        testCode: t.testCode,
        testName: t.testName,
        resultType: t.resultType,
        unit: null,
        isRequired: t.testMode === 'COMPULSORY',
        displayOrder: i,
        resultOptions: null,
      })),
    [policyTests]
  );

  // Fetch active sources for global users if needed
  useEffect(() => {
    // Safely remove legacy un-scoped singleton key from storage on mount
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('mpd_active_draft_visit_id');
    }

    async function loadSources() {
      if (!isSourceBound && currentUser?.role === 'SUPER_ADMIN') {
        try {
          const res = await fetch('/api/super-admin/procurement-sources');
          const data = await res.json();
          if (data.sources) {
            const normalized = data.sources.map((s: { id: string; name: string; sourceType?: string; source_type?: string }) => ({
              id: s.id,
              name: s.name,
              source_type: s.sourceType || s.source_type || '',
            }));
            const list = sourceType
              ? normalized.filter((s: { source_type: string }) => s.source_type === sourceType)
              : normalized;
            setAvailableSources(list);
            // Requirement A: Leave selectedSourceId empty initially; do NOT auto-select first source
          }
        } catch (err) {
          console.error('Failed to load procurement sources', err);
        }
      }
    }
    loadSources();
  }, [isSourceBound, currentUser?.role, sourceType]);

  // Load available vehicles and MOT profiles for ZMCC
  useEffect(() => {
    if (!effectiveSourceId || isContractorSource) {
      setAvailableVehicles([]);
      setAvailableMotProfiles([]);
      setSelectedMotVehicleId('');
      setSelectedMotProfileId('');
      return;
    }
    let alive = true;
    setIsLoadingResources(true);
    fetch(`/api/dispatches/resources?sourceId=${effectiveSourceId}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'Failed to load dispatch resources');
        return d;
      })
      .then((data) => {
        if (!alive) return;
        setAvailableVehicles(data.vehicles || []);
        setAvailableMotProfiles(data.motProfiles || []);
      })
      .catch((err) => {
        console.error('Failed to load dispatch resources:', err);
      })
      .finally(() => {
        if (alive) setIsLoadingResources(false);
      });
    return () => {
      alive = false;
    };
  }, [effectiveSourceId, isContractorSource]);

  // Tests, rules and picture needs for this dispatch point.
  useEffect(() => {
    if (!policyPoint || !effectiveSourceId) return;
    let alive = true;
    const key = `${policyPoint}:${effectiveSourceId}`;
    fetch(`/api/dispatches/policy?point=${policyPoint}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'Could not load the test rules.');
        return d as DispatchPolicySnapshot;
      })
      .then((d) => {
        if (alive) {
          setPolicy(d);
          setPolicyError(null);
        }
      })
      .catch((err) => {
        if (alive) setPolicyError(getErrorMessage(err) || 'Could not load the test rules.');
      })
      .finally(() => {
        if (alive) setPolicyLoadedFor(key);
      });
    return () => {
      alive = false;
    };
  }, [policyPoint, effectiveSourceId]);

  const buildInitialPortionResults = (tests: LabTestDef[]): Record<string, TestResultState> => {
    const res: Record<string, TestResultState> = {};
    tests.forEach((t) => {
      res[t.testId] = { numericValue: '', textValue: '', performanceStatus: 'PERFORMED', notPerformedReason: '' };
    });
    return res;
  };

  // Draft visit ID tracking
  const [draftVisitId, setDraftVisitId] = useState<string | null>(null);

  // Track in-flight initialization to avoid duplicate concurrent POSTs
  const inFlightInitRef = useRef<{ userId: string; sourceId: string } | null>(null);
  const initSeqRef = useRef(0);

  // Source whose work-item initialization last settled; any other source is still loading.
  const [testsLoadedForSourceId, setTestsLoadedForSourceId] = useState<string | null>(null);
  const isLoadingTests =
    restartingWorkItem ||
    (Boolean(effectiveSourceId) && testsLoadedForSourceId !== effectiveSourceId) ||
    (Boolean(effectiveSourceId) && policyLoadedFor !== `${policyPoint}:${effectiveSourceId}`);

  const initializeDispatchWorkItem = (targetSourceId: string, forceNew = false) => {
    if (!currentUser || !targetSourceId) return;

    if (
      !forceNew &&
      inFlightInitRef.current?.userId === currentUser.id &&
      inFlightInitRef.current?.sourceId === targetSourceId
    ) {
      return;
    }

    const userId = currentUser.id;
    inFlightInitRef.current = { userId, sourceId: targetSourceId };
    const currentSeq = ++initSeqRef.current;
    const scopedKey = getScopedDraftKey(userId, targetSourceId);

    return startDispatchWorkItem(targetSourceId, scopedKey, forceNew)
      .then((data) => {
        // If a newer initialization request began, ignore this outdated response
        if (initSeqRef.current !== currentSeq) return;

        setDraftVisitId(data.visitId);
        if (data.quantityPolicy?.policy) {
          setFrozenQuantityPolicy(data.quantityPolicy);
          const vDef = data.quantityPolicy.policy.vehicleRules?.default;
          if (vDef) {
            setVehicleQuantity({
              value: '',
              unit: vDef.unit,
              basis: 'MEASURED',
            });
          }
        }
        if (typeof window !== 'undefined' && data.visitId && scopedKey) {
          sessionStorage.setItem(scopedKey, data.visitId);
        }

        const initialResults = buildInitialPortionResults(labTests);

        if (data.quantityPolicy?.policy) {
          const pDef = data.quantityPolicy.policy.portionRules?.default;
          if (pDef) {
            setPortions([
              {
                clientId: 'portion-1',
                portionNumber: 1,
                quantity: {
                  value: '',
                  unit: pDef.unit,
                  basis: pDef.basis,
                },
                sealNumber: '',
                results: initialResults,
                photos: {},
                isSaved: false,
              },
            ]);
          }
        }
      })
      .catch((err) => {
        if (initSeqRef.current === currentSeq) {
          toast.showError(getErrorMessage(err) || 'Failed to initialize dispatch test catalog', 'Load Error');
        }
      })
      .finally(() => {
        if (inFlightInitRef.current?.userId === userId && inFlightInitRef.current?.sourceId === targetSourceId) {
          inFlightInitRef.current = null;
        }
        if (initSeqRef.current === currentSeq) {
          setRestartingWorkItem(false);
          setTestsLoadedForSourceId(targetSourceId);
        }
      });
  };

  /** Discards the current draft and starts a fresh work item (user actions only). */
  const restartDispatchWorkItem = (targetSourceId: string) => {
    if (!currentUser || !targetSourceId) return;
    setRestartingWorkItem(true);
    initializeDispatchWorkItem(targetSourceId, true);
  };

  // Initialize when the source changes. The effect event reads the latest user/source
  // without re-running initialization when their object identities change.
  const initializeForSource = useEffectEvent((sourceId: string) => {
    initializeDispatchWorkItem(sourceId);
  });

  useEffect(() => {
    if (effectiveSourceId) {
      initializeForSource(effectiveSourceId);
    }
  }, [effectiveSourceId]);

  // Derived options for vehicle and portions based on policy
  const isPolicyReady = !!frozenQuantityPolicy?.policy;

  // Vehicle Allowed Rules
  const vehicleAllowedMeasurements = frozenQuantityPolicy?.policy?.vehicleRules?.allowedMeasurements;
  const defaultUnits: QuantityUnit[] = ['KG', 'LITER'];
  const defaultBases: MeasurementBasis[] = ['MEASURED'];

  const vehicleAllowedUnits: QuantityUnit[] = isPolicyReady && vehicleAllowedMeasurements
    ? getAllowedUnits(vehicleAllowedMeasurements)
    : defaultUnits;

  const vehicleAllowedBases: MeasurementBasis[] = isPolicyReady && vehicleAllowedMeasurements && vehicleQuantity.unit
    ? getAllowedBases(vehicleAllowedMeasurements, vehicleQuantity.unit)
    : defaultBases;

  // Portion Allowed Rules
  // Until the source's policy snapshot loads, use the same default the server falls back to.
  const portionAllowedMeasurements =
    frozenQuantityPolicy?.policy?.portionRules?.allowedMeasurements ??
    DEFAULT_DISPATCH_QUANTITY_POLICY.portionRules.allowedMeasurements;
  const portionAllowedUnits: QuantityUnit[] = isPolicyReady && portionAllowedMeasurements
    ? getAllowedUnits(portionAllowedMeasurements)
    : defaultUnits;

  const createFreshPortion = (portionNumber: number): PortionFormState => {
    const freshResults = buildInitialPortionResults(labTests);
    const pDef = frozenQuantityPolicy?.policy?.portionRules?.default;
    const defaultUnit: QuantityUnit = pDef?.unit || 'KG';
    const defaultBasis: MeasurementBasis = pDef?.basis || 'MEASURED';

    return {
      clientId: `portion-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      portionNumber,
      quantity: portions.length > 0
        ? createPortionQuantityFromSharedProfile(
            portions[0].quantity,
            { unit: defaultUnit, basis: defaultBasis }
          )
        : {
            value: '',
            unit: defaultUnit,
            basis: defaultBasis,
          },
      sealNumber: '',
      results: freshResults,
      photos: {},
      isSaved: false,
    };
  };

  // Private server draft of the typed values, so this login continues on any device. Never a result.
  const draftFormType: DraftFormType = isContractorSource ? 'CONTRACTOR_DISPATCH' : effectiveSource?.source_type === 'ZMCC' ? 'ZMCC_DISPATCH' : 'DISPATCH';
  const serverDraft = useServerDraft({
    formType: draftFormType,
    scopeId: result ? null : draftVisitId,
    portionKey: 'form',
    content: dispatchDraftFromForm(portions, { vehicleNumber, rawMilkDispatchNoteNumber, remarks: dispatchTestingRemarks }),
    onRemote: (content, reason) => {
      setPortions((prev) => applyDraftToPortions(prev, content, reason, createFreshPortion));
      const extras = applyDraftToExtras({ vehicleNumber, rawMilkDispatchNoteNumber, remarks: dispatchTestingRemarks }, content, reason);
      setVehicleNumber(extras.vehicleNumber);
      setRawMilkDispatchNoteNumber(extras.rawMilkDispatchNoteNumber);
      setDispatchTestingRemarks(extras.remarks);
    },
  });

  // --- Handlers for Vehicle Quantity ---
  const handleVehicleNumberChange = (val: string) => {
    setVehicleNumber(val);
    if (vehicleNumberError && val.trim().length > 0) {
      setVehicleNumberError(null);
    }
  };

  const handleSelectVehicle = (vId: string, vNum: string) => {
    setSelectedMotVehicleId(vId);
    setVehicleNumber(vNum);
    if (vehicleNumberError) {
      setVehicleNumberError(null);
    }
  };

  const handleSelectMotProfile = (pId: string) => {
    setSelectedMotProfileId(pId);
    if (motError) {
      setMotError(null);
    }
    const found = availableMotProfiles.find((p) => p.id === pId);
    if (found && !driverName) {
      setDriverName(found.name);
    }
  };

  const handleDriverNameChange = (name: string) => {
    setDriverName(name);
    if (driverError && name.trim().length > 0) {
      setDriverError(null);
    }
  };

  const handleNextToPortions = () => {
    let hasError = false;
    if (!vehicleNumber.trim()) {
      setVehicleNumberError('Vehicle number is required.');
      hasError = true;
    }
    if (!isContractorSource && !selectedMotProfileId && !driverName.trim()) {
      setMotError('Please select an MOT escort or enter driver/escort name.');
      hasError = true;
    }
    if (isContractorSource && !driverName.trim()) {
      setDriverError('Contractor driver name is required.');
      hasError = true;
    }
    if (hasError) {
      toast.showError('Please provide vehicle number and escort/driver name before proceeding.', 'Required fields');
      return;
    }
    setVehicleNumberError(null);
    setMotError(null);
    setDriverError(null);
    setFormStep(1);
  };

  const handleVehicleQuantityValueChange = (val: string) => {
    setVehicleQuantity((prev) => ({ ...prev, value: val }));
    if (vehicleQuantityError && Number(val) > 0) {
      setVehicleQuantityError(null);
    }
  };

  const handleVehicleUnitChange = (newUnit: QuantityUnitType) => {
    setVehicleQuantity((prev) => ({
      ...prev,
      unit: newUnit,
      basis: 'MEASURED',
    }));
  };

  const handleVehicleBasisChange = (_newBasis: MeasurementBasisType) => {
    setVehicleQuantity((prev) => ({
      ...prev,
      basis: 'MEASURED',
    }));
  };

  const handleVehicleLrChange = (val: string) => {
    setIsVehicleQualityAuto(false);
    setVehicleLr(val);
  };

  const handleVehicleFatChange = (val: string) => {
    setIsVehicleQualityAuto(false);
    setVehicleFat(val);
  };

  // Automated Whole-Vehicle Net Weight = Sum of all portion quantities
  const totalPortionNetWeightKg = React.useMemo(() => {
    const sum = portions.reduce((acc, p) => acc + (parseFloat(p.quantity.value) || 0), 0);
    return sum > 0 ? sum.toFixed(2) : '';
  }, [portions]);

  // Keep vehicleQuantity in sync with portion sum and locked to KG
  const [syncedPortionWeight, setSyncedPortionWeight] = useState(totalPortionNetWeightKg);
  if (totalPortionNetWeightKg !== syncedPortionWeight) {
    setSyncedPortionWeight(totalPortionNetWeightKg);
    setVehicleQuantity((prev) => ({
      ...prev,
      value: totalPortionNetWeightKg,
      unit: 'KG',
      basis: 'MEASURED',
    }));
    if (vehicleQuantityError && Number(totalPortionNetWeightKg) > 0) {
      setVehicleQuantityError(null);
    }
  }

  const handleResetVehicleQualityAuto = () => {
    setIsVehicleQualityAuto(true);
  };

  // Automated Vehicle LR & Fat Calculation from Portions (Volume-Weighted Average)
  const autoVehicleQuality = isVehicleQualityAuto ? computeAutoVehicleQuality(portions, labTests, policyTests) : null;
  const vehicleLr = autoVehicleQuality ? autoVehicleQuality.lr : manualVehicleLr;
  const vehicleFat = autoVehicleQuality ? autoVehicleQuality.fat : manualVehicleFat;

  // --- Handlers for Portions ---
  const handlePortionQuantityValueChange = (index: number, val: string) => {
    const updated = [...portions];
    updated[index].quantity.value = val;
    setPortions(updated);

    if (portionErrors[index]?.quantity && Number(val) > 0) {
      setPortionErrors((prev) => {
        const copy = { ...prev[index] };
        delete copy.quantity;
        return { ...prev, [index]: copy };
      });
    }
  };

  const handlePortionUnitChange = (index: number, newUnit: QuantityUnitType) => {
    if (index === 0) {
      // Cascading update to all portions
      const updated = applySharedPortionUnit(portions, newUnit, portionAllowedMeasurements);
      setPortions(updated);
    } else {
      const updated = [...portions];
      const bases = getAllowedBases(portionAllowedMeasurements, newUnit);
      const newBasis = bases.includes(updated[index].quantity.basis) ? updated[index].quantity.basis : bases[0];
      updated[index].quantity.unit = newUnit;
      updated[index].quantity.basis = newBasis;
      setPortions(updated);
    }
  };

  const handlePortionBasisChange = (index: number, newBasis: MeasurementBasisType) => {
    if (index === 0) {
      // Cascading update to all portions
      const updated = applySharedPortionBasis(portions, newBasis);
      setPortions(updated);
    } else {
      const updated = [...portions];
      updated[index].quantity.basis = newBasis;
      setPortions(updated);
    }
  };

  const handleAddPortionClick = () => {
    if (editingPortionIndex !== null) {
      const currentEditing = portions[editingPortionIndex];
      if (!currentEditing.isSaved) {
        toast.showWarning('Please save or complete the current portion before adding a new one.', 'Save Active Portion');
        return;
      }
    }

    const nextNum = portions.length + 1;
    const newPortion = createFreshPortion(nextNum);
    setPortions([...portions, newPortion]);
    setEditingPortionIndex(portions.length);
  };

  const handleTestResultChange = (
    portionIndex: number,
    testId: string,
    field: 'numericValue' | 'textValue',
    value: string
  ) => {
    const updated = [...portions];
    const currentRes = updated[portionIndex].results[testId] || {
      numericValue: '',
      textValue: '',
      performanceStatus: 'PERFORMED',
      notPerformedReason: '',
    };
    updated[portionIndex].results[testId] = { ...currentRes, [field]: value };
    setPortions(updated);
    setNeedsRequest(null);

    if (portionErrors[portionIndex]?.tests?.[testId]) {
      setPortionErrors((prev) => {
        const testsCopy = { ...prev[portionIndex].tests };
        delete testsCopy[testId];
        return { ...prev, [portionIndex]: { ...prev[portionIndex], tests: testsCopy } };
      });
    }
  };

  const handleSealChange = (index: number, value: string) => {
    const updated = [...portions];
    updated[index].sealNumber = value;
    setPortions(updated);
    setSealServerError(null);
    setNeedsRequest(null);
    if (portionErrors[index]?.seal && value.trim()) {
      setPortionErrors((prev) => {
        const copy = { ...prev[index] };
        delete copy.seal;
        return { ...prev, [index]: copy };
      });
    }
  };

  const handlePortionPhotoTaken = (index: number, test: DispatchPolicyTest, res: LiveCameraResult) => {
    const updated = [...portions];
    updated[index].photos = { ...updated[index].photos, [test.labTestId]: toPhotoState(res) };
    setPortions(updated);
    setNeedsRequest(null);
  };

  const handlePortionPhotoRemoved = (index: number, labTestId: string) => {
    const updated = [...portions];
    const next = { ...updated[index].photos };
    delete next[labTestId];
    updated[index].photos = next;
    setPortions(updated);
  };

  const handleTestModeChange = (mode: DispatchTestMode) => {
    if (mode === testMode) {
      // Tapping the active mode still opens the portion sheet.
      const firstOpenNow = portions.findIndex((p) => !p.isSaved);
      setEditingPortionIndex(firstOpenNow >= 0 ? firstOpenNow : 0);
      return;
    }
    if (mode === 'COMPOSITE' && portions.length > 1) {
      if (typeof window !== 'undefined' && !window.confirm('Switching to Composite mode records all tests under Portion 1. Any additional portions will be removed. Continue?')) {
        return;
      }
      setPortions((prev) => prev.slice(0, 1));
      setEditingPortionIndex(null);
    }
    setTestMode(mode);
    setNeedsRequest(null);
    // Choosing a mode opens the portion sheet: first unsaved portion, else the first one.
    const kept = mode === 'COMPOSITE' ? portions.slice(0, 1) : portions;
    const firstOpen = kept.findIndex((p) => !p.isSaved);
    setEditingPortionIndex(firstOpen >= 0 ? firstOpen : 0);
  };

  const handleSavePortion = (index: number): boolean => {
    const target = portions[index];
    if (!target) return false;

    const errors: { quantity?: string; seal?: string; tests: Record<string, string> } = { tests: {} };
    let firstInvalidId: string | null = null;

    const qty = Number(target.quantity.value);
    const unitLabel = target.quantity.unit === 'LITER' ? 'L' : 'kg';
    if (!target.quantity.value || isNaN(qty) || qty <= 0) {
      errors.quantity = `Please enter a valid portion quantity (${unitLabel} > 0).`;
      firstInvalidId = `portion-qty-input-${index}`;
    }

    const seal = target.sealNumber.trim();
    if (!seal) {
      errors.seal = 'Please write the seal number.';
      if (!firstInvalidId) firstInvalidId = `portion-seal-input-${index}`;
    } else if (getDuplicateSealMessage(portions, index)) {
      errors.seal = getDuplicateSealMessage(portions, index) as string;
      if (!firstInvalidId) firstInvalidId = `portion-seal-input-${index}`;
    }

    // Empty tests are allowed here (the decision step handles missing compulsory tests). A typed value must be a valid number.
    policyTests.forEach((t) => {
      if (!isNumericTest(t)) return;
      const r = target.results[t.labTestId];
      if (r && r.numericValue !== '') {
        const n = Number(r.numericValue);
        if (isNaN(n) || n < 0) {
          errors.tests[t.labTestId] = `${t.testName} must be a number, zero or more.`;
          if (!firstInvalidId) firstInvalidId = `test-input-field-${index}-${t.labTestId}`;
        }
      }
    });

    const hasErrors = !!errors.quantity || !!errors.seal || Object.keys(errors.tests).length > 0;
    if (hasErrors) {
      setPortionErrors((prev) => ({ ...prev, [index]: errors }));
      toast.showError('Please fix the marked fields before saving.', 'Portion Check');
      if (firstInvalidId) {
        const el = document.getElementById(firstInvalidId);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.focus();
        }
      }
      return false;
    }

    setPortionErrors((prev) => {
      const updated = { ...prev };
      delete updated[index];
      return updated;
    });

    const updated = [...portions];
    updated[index].isSaved = true;
    setPortions(updated);
    setEditingPortionIndex(null);
    toast.showSuccess(`Portion ${target.portionNumber} saved.`);
    return true;
  };

  const handleEditPortion = (index: number) => {
    setEditingPortionIndex(index);
  };

  const handleRemovePortion = (index: number) => {
    if (portions.length <= 1) {
      toast.showWarning('At least one portion is required for a dispatch.', 'Portion Required');
      return;
    }

    const updated = portions.filter((_, i) => i !== index).map((p, i) => ({
      ...p,
      portionNumber: i + 1,
    }));
    setPortions(updated);

    // Re-index errors
    setPortionErrors((prev) => {
      const newErrors: Record<number, { quantity?: string; seal?: string; tests?: Record<string, string> }> = {};
      Object.keys(prev).forEach((keyStr) => {
        const k = Number(keyStr);
        if (k < index) newErrors[k] = prev[k];
        else if (k > index) newErrors[k - 1] = prev[k];
      });
      return newErrors;
    });

    if (editingPortionIndex === index) {
      setEditingPortionIndex(null);
    } else if (editingPortionIndex !== null && editingPortionIndex > index) {
      setEditingPortionIndex(editingPortionIndex - 1);
    }
  };

  const getPortionProgress = (portion: PortionFormState) => {
    const compulsory = policyTests.filter((t) => t.testMode === 'COMPULSORY');
    // A calculated test counts as done once its LR and Fat are in; the others once they are filled.
    const calculated = calculatedValuesForPortion(policyTests, (t) => portion.results[t.labTestId]?.numericValue);
    const done = compulsory.filter((t) => (t.labTestId in calculated ? calculated[t.labTestId] !== null : isFilled(portion, t))).length;
    return {
      label: `${done}/${compulsory.length} must-do tests done`,
      accounted: done,
      total: compulsory.length,
    };
  };

  // Live milk values of a portion (unit-safe), from its LR and Fat tests.
  const computeCalculatedMilkValues = (portion: PortionFormState) => {
    const lrTest = policyTests.find((t) => t.isLr);
    const fatTest = policyTests.find((t) => t.isFat);
    const rawLr = lrTest ? portion.results[lrTest.labTestId]?.numericValue ?? '' : '';
    const rawFat = fatTest ? portion.results[fatTest.labTestId]?.numericValue ?? '' : '';
    return computeDispatchPortionCalculatedValues(portion.quantity.value, portion.quantity.unit, rawLr, rawFat);
  };

  const savedCount = portions.filter((p) => p.isSaved).length;

  const stamp = {
    employeeCode: meCode,
    roleLabel,
    pointLabel: isContractorSource ? 'Contractor dispatch' : 'ZMCC dispatch',
    vehicleNo: vehicleNumber.trim().toUpperCase() || null,
  };

  const preview = buildDispatchPreview({
    tests: policyTests,
    portions: portions.map((p) => ({
      portionNumber: p.portionNumber,
      values: Object.fromEntries(
        policyTests.map((t) => [
          t.labTestId,
          { value: p.results[t.labTestId]?.numericValue ?? '', text: p.results[t.labTestId]?.textValue ?? '' },
        ])
      ),
      photos: Object.fromEntries(Object.keys(p.photos).map((k) => [k, true])),
    })),
    labReportTaken: Boolean(labReportPhoto),
    personDecision,
    remarks: decisionRemarks,
    deciderCanApprove,
  });

  // The banner and buttons follow the route, not just the test result: a missing picture is an exception even when every rule passed.
  const goesToApprover = preview.decision?.route === 'SEND_TO_APPROVER';
  // Plain reasons shown when the user taps the warning icon.
  // Things still to finish before the form can be sent at all.
  const incompleteLines: string[] = [
    ...(portions.length === 0 ? ['Add at least one milk portion.'] : []),
    ...portions
      .map((p, i) => (p.isSaved ? null : `Portion ${i + 1}: enter quantity and tests, then save.`))
      .filter((x): x is string => x !== null),
    ...(!vehicleNumber.trim() ? ['Vehicle number is missing.'] : []),
    ...(!vehicleQuantity.value || Number(vehicleQuantity.value) <= 0 ? ['Vehicle quantity is missing.'] : []),
  ];
  const showWarning = goesToApprover || incompleteLines.length > 0;
  const whyLines: string[] = [
    ...incompleteLines,
    ...preview.rows.filter((r) => r.outcome === 'FAIL').map((r) => `${r.name}: outside the allowed range.`),
    ...preview.rows.filter((r) => r.note === 'Must be done' || r.note?.startsWith('Must be done.')).map((r) => `${r.name}: must-do test is empty.`),
    ...preview.rows.filter((r) => r.note?.includes('Picture missing')).map((r) => `${r.name}: picture missing.`),
    ...(preview.decision?.exceptionReasons ?? [])
      .filter((x) => x === 'MISMATCH' || x === 'AWAY_FROM_SHOP')
      .map((x) => exceptionReasonText(x)),
  ];

  /** Uploads the pictures that are waiting. A picture stays in the queue until its upload works. */
  const runUploads = async (queue: PendingUpload[]) => {
    if (queue.length === 0) return;
    setUploading(true);
    const failed: PendingUpload[] = [];
    for (const item of queue) {
      try {
        const form = new FormData();
        form.append('file', item.photo.blob, `${item.photo.captureId}.jpg`);
        form.append(
          'meta',
          JSON.stringify({
            captureId: item.photo.captureId,
            sha256: item.photo.sha256,
            testingPoint: item.testingPoint,
            entityType: item.entityType,
            entityId: item.entityId,
            labTestId: item.labTestId,
            portionNumber: item.portionNumber,
            photoKind: item.photoKind,
            deviceCapturedAt: item.photo.capturedAt,
            latitude: item.photo.gps?.lat ?? null,
            longitude: item.photo.gps?.lng ?? null,
            gpsAccuracyM: item.photo.gps?.accuracyM ?? null,
            wasOffline: false,
            width: item.photo.width,
            height: item.photo.height,
            policyVersion: item.policyVersion,
          })
        );
        const r = await fetch('/api/photos', { method: 'POST', body: form });
        if (!r.ok) throw new Error('upload failed');
      } catch {
        failed.push(item);
      }
    }
    setUploadQueue(failed);
    setUploading(false);
  };

  const buildPayloadPortions = (isoDispatchTimestamp: string | undefined) =>
    portions.map((p) => ({
      portionNumber: p.portionNumber,
      seal_number: p.sealNumber.trim(),
      quantity: {
        value: Number(p.quantity.value),
        unit: p.quantity.unit,
        basis: p.quantity.basis,
      },
      dispatchTimestamp: isoDispatchTimestamp,
      results: [] as unknown[],
      // Calculated tests (SNF, TS, ratio) are not sent: the server does not recompute them for the dispatch decision.
      test_results: policyTests
        .filter((t) => !isCalculatedTest(t))
        .map((t) => {
          const r = p.results[t.labTestId];
          const numeric = isNumericTest(t) && r && r.numericValue !== '' ? Number(r.numericValue) : null;
          const text = !isNumericTest(t) && r && r.textValue.trim() ? r.textValue.trim() : null;
          return { lab_test_id: t.labTestId, value: numeric, text_value: text };
        })
        .filter((x) => x.value !== null || x.text_value !== null),
      photos: Object.keys(p.photos).map((labTestId) => ({ lab_test_id: labTestId, capture_id: p.photos[labTestId].captureId })),
    }));

  const submitDispatch = async (action: 'SUBMIT' | 'SEND_REQUEST') => {
    setSubmitError(null);
    setSealServerError(null);

    if (!vehicleNumber.trim()) {
      setVehicleNumberError('Vehicle Registration Number is required.');
      toast.showError('Please enter a vehicle registration number.', 'Check the form');
      document.getElementById('vehicle-number-input')?.focus();
      return;
    }
    const vehQtyNum = Number(vehicleQuantity.value);
    if (!vehicleQuantity.value || isNaN(vehQtyNum) || vehQtyNum <= 0) {
      setVehicleQuantityError('A valid whole-vehicle dispatch quantity (> 0) is required.');
      toast.showError('Please enter the milk quantity of each portion.', 'Check the form');
      return;
    }
    if (portions.length === 0) {
      toast.showError('At least one milk portion is needed.', 'Portion needed');
      return;
    }
    if (testMode === 'COMPOSITE' && portions.length !== 1) {
      toast.showError('Composite test mode requires all tests recorded under One portion.', 'Check the form');
      return;
    }
    if (editingPortionIndex !== null) {
      if (!handleSavePortion(editingPortionIndex)) return;
    }
    if (portions.some((p, i) => !p.isSaved && i !== editingPortionIndex)) {
      toast.showError('Please save every portion first.', 'Unsaved portions');
      return;
    }
    // Duplicate seals (the server checks again).
    const dupIndex = portions.findIndex((_, i) => getDuplicateSealMessage(portions, i));
    if (dupIndex >= 0) {
      setPortionErrors((prev) => ({ ...prev, [dupIndex]: { ...prev[dupIndex], seal: getDuplicateSealMessage(portions, dupIndex) as string } }));
      setEditingPortionIndex(dupIndex);
      toast.showError('Two portions have the same seal number.', 'Seal number');
      return;
    }
    const effectivePersonDecision = personDecision || 'ACCEPT';
    const effectiveAction: 'SUBMIT' | 'SEND_REQUEST' =
      action === 'SEND_REQUEST' || needsRequest || preview.decision?.route === 'SEND_TO_APPROVER'
        ? 'SEND_REQUEST'
        : 'SUBMIT';
    if (!effectiveSource?.id || !draftVisitId || !policy || !policyPoint) {
      toast.showError('The form is still loading. Please wait a moment.', 'Please wait');
      return;
    }
    if (effectiveAction === 'SEND_REQUEST' && (!decisionRemarks || decisionRemarks.trim().length < 3)) {
      toast.showError(`Please write a short reason (at least 3 letters) to send request to ${approverLabel}.`, 'Reason needed');
      return;
    }

    setIsSubmitting(true);
    try {
      const isoDispatchTimestamp = datetimeLocalToIso(dispatchOpDatetime) || undefined;
      const payloadPortions = buildPayloadPortions(isoDispatchTimestamp);
      const anyTested = payloadPortions.some((p) => p.test_results.length > 0);
      const allTested = policyTests
        .filter((t) => t.testMode === 'COMPULSORY' && !isCalculatedTest(t))
        .every((t) => payloadPortions.every((p) => p.test_results.some((x) => x.lab_test_id === t.labTestId)));
      const dispatchTestingMode: 'FULL' | 'PARTIAL' | 'NOT_PERFORMED' = !anyTested ? 'NOT_PERFORMED' : allTested ? 'FULL' : 'PARTIAL';

      let finalVehicleLr = vehicleLr;
      let finalVehicleFat = vehicleFat;
      if (!finalVehicleLr || !finalVehicleFat) {
        const auto = computeAutoVehicleQuality(portions, labTests, policyTests);
        if (!finalVehicleLr && auto.lr) finalVehicleLr = auto.lr;
        if (!finalVehicleFat && auto.fat) finalVehicleFat = auto.fat;
      }
      const effectiveDispatchDate = isoDispatchTimestamp || new Date().toISOString();
      const remarks = decisionRemarks.trim() || null;

      const res = await fetch('/api/dispatches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitId: draftVisitId,
          vehicleNumber: vehicleNumber.trim().toUpperCase(),
          operationalDate: effectiveDispatchDate,
          procurementSourceId: effectiveSource.id,
          zonalContractorName: effectiveSource.name,
          dispatchTestingMode,
          dispatchTestingReason: null,
          dispatchTestingRemarks: dispatchTestingRemarks.trim() || remarks || undefined,
          vehicleQuantity: {
            value: Number(vehicleQuantity.value),
            unit: vehicleQuantity.unit,
            basis: vehicleQuantity.basis,
            lr: finalVehicleLr && !isNaN(Number(finalVehicleLr)) ? Number(finalVehicleLr) : undefined,
            fat: finalVehicleFat && !isNaN(Number(finalVehicleFat)) ? Number(finalVehicleFat) : undefined,
          },
          vehicleLr: finalVehicleLr && !isNaN(Number(finalVehicleLr)) ? Number(finalVehicleLr) : undefined,
          vehicleFat: finalVehicleFat && !isNaN(Number(finalVehicleFat)) ? Number(finalVehicleFat) : undefined,
          rawMilkDispatchNoteNumber: rawMilkDispatchNoteNumber.trim() || undefined,
          motVehicleId: selectedMotVehicleId || undefined,
          motProfileId: selectedMotProfileId || undefined,
          driverName: driverName.trim() || undefined,
          testMode,
          action: effectiveAction,
          personDecision: effectivePersonDecision,
          decisionRemarks: remarks,
          labReportCaptureId: labReportPhoto?.captureId ?? null,
          portions: payloadPortions,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as UnknownRecord;

      if (res.status === 409 && data.code === 'EXCEPTION_NEEDS_REQUEST') {
        setNeedsRequest((data.decision as DecisionResult) ?? preview.decision);
        setSubmitError(`This cannot be submitted normally. Please send a request to the ${approverLabel}.`);
        return;
      }
      if (res.status === 409 && data.code === 'SEAL_DUPLICATE') {
        const sealNo = typeof data.sealNumber === 'string' ? data.sealNumber : '';
        const msg = `Seal number ${sealNo} is already used. Please write a different seal number.`;
        setSealServerError(msg);
        setSubmitError(msg);
        const idx = portions.findIndex((p) => p.sealNumber.trim().toUpperCase() === sealNo.trim().toUpperCase());
        if (idx >= 0) {
          setPortionErrors((prev) => ({ ...prev, [idx]: { ...prev[idx], seal: msg } }));
          setEditingPortionIndex(idx);
          setPortions((prev) => prev.map((p, i) => (i === idx ? { ...p, isSaved: false } : p)));
        }
        return;
      }
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to save the dispatch.');
      }

      const dispatch = asRecord(data.dispatch);
      const dispatchId = pickString(dispatch, 'id', 'visit_id', 'visitId') ?? draftVisitId;
      const status = pickString(dispatch, 'status', 'current_status') ?? (action === 'SEND_REQUEST' ? 'PENDING_APPROVAL' : 'DISPATCHED');
      const dispatchNumber = pickString(dispatch, 'dispatchNumber', 'dispatch_number', 'visit_number') ?? String(dispatchId).slice(0, 8);

      // Pictures go up after the dispatch is saved. They stay on this phone until the upload works.
      const serverPortions = (Array.isArray(dispatch.portions) ? dispatch.portions : Array.isArray(data.portions) ? data.portions : []) as unknown[];
      const queue: PendingUpload[] = [];
      for (const p of portions) {
        const sp = serverPortions
          .map(asRecord)
          .find((x) => Number(x.portion_number ?? x.portionNumber) === p.portionNumber);
        const portionId = sp ? pickString(sp, 'id') : null;
        if (!portionId) continue;
        for (const [labTestId, photo] of Object.entries(p.photos)) {
          const t = policyTests.find((x) => x.labTestId === labTestId);
          queue.push({
            key: `p${p.portionNumber}:${labTestId}`,
            label: `Portion ${p.portionNumber} - ${t?.testName ?? 'test'}`,
            photo,
            entityType: 'dispatch_portion',
            entityId: portionId,
            labTestId,
            portionNumber: p.portionNumber,
            photoKind: 'TEST_RESULT',
            testingPoint: policyPoint,
            policyVersion: policy.version,
          });
        }
      }
      if (labReportPhoto) {
        queue.push({
          key: 'lab-report',
          label: 'Hand-written lab report',
          photo: labReportPhoto,
          entityType: 'dispatch_info',
          entityId: String(dispatchId),
          labTestId: labReportTest?.labTestId ?? null,
          portionNumber: null,
          photoKind: 'LAB_REPORT',
          testingPoint: policyPoint,
          policyVersion: policy.version,
        });
      }

      serverDraft.discard();
      const t = asRecord(data.totals);
      setResult({
        dispatchNumber,
        status,
        totals: data.totals
          ? {
              grossLiters: Number(t.grossLiters),
              weightedLr: Number(t.weightedLr),
              weightedFat: Number(t.weightedFat),
              weightedTs13: Number(t.weightedTs13),
            }
          : null,
        tankRemainingLiters: typeof data.tankRemainingLiters === 'number' ? data.tankRemainingLiters : null,
        decision: (data.decision as DecisionResult) ?? null,
        approverLabel,
      });
      setUploadQueue(queue);
      setNeedsRequest(null);

      const scopedKey = getScopedDraftKey(currentUser?.id, effectiveSourceId);
      if (scopedKey && typeof window !== 'undefined') sessionStorage.removeItem(scopedKey);
      onSuccess?.();
      void runUploads(queue);
    } catch (err) {
      const msg = getErrorMessage(err) || 'An error occurred while saving the dispatch.';
      setSubmitError(msg);
      toast.showError(msg, 'Could not save');
    } finally {
      setIsSubmitting(false);
    }
  };

  /** After a finished dispatch: clear everything and start the next one. */
  const startNextDispatch = () => {
    portions.forEach((p) => Object.values(p.photos).forEach((ph) => URL.revokeObjectURL(ph.previewUrl)));
    if (labReportPhoto) URL.revokeObjectURL(labReportPhoto.previewUrl);
    setResult(null);
    setUploadQueue([]);
    setLabReportPhoto(null);
    setPersonDecision(null);
    setDecisionRemarks('');
    setNeedsRequest(null);
    setSubmitError(null);
    setSealServerError(null);
    setReopenedNote(null);
    setVehicleNumber('');
    setRawMilkDispatchNoteNumber('');
    setVehicleQuantity((prev) => ({ ...prev, value: '' }));
    setVehicleLr('');
    setVehicleFat('');
    setIsVehicleQualityAuto(true);
    setDispatchTestingRemarks('');
    setPortions([]);
    setPortionErrors({});
    setEditingPortionIndex(0);
    setDraftVisitId(null);
    if (effectiveSourceId) restartDispatchWorkItem(effectiveSourceId);
  };

  const handleClearDraft = () => {
    const scopedKey = getScopedDraftKey(currentUser?.id, effectiveSourceId);
    if (scopedKey && typeof window !== 'undefined') {
      sessionStorage.removeItem(scopedKey);
    }
    toast.showInfo('Draft cleared. Starting a fresh dispatch…');
    startNextDispatch();
  };

  const handleOpenDecide = () => {
    // If user is currently editing a portion, validate and save it first
    if (editingPortionIndex !== null) {
      const ok = handleSavePortion(editingPortionIndex);
      if (!ok) return;
    }
    const unsavedIdx = portions.findIndex((p) => !p.isSaved);
    if (unsavedIdx >= 0) {
      const ok = handleSavePortion(unsavedIdx);
      if (!ok) {
        setEditingPortionIndex(unsavedIdx);
        return;
      }
    }
    if (!personDecision) {
      setPersonDecision('ACCEPT');
    }
    setDecideOpen(true);
  };

  const handleSubmitDispatch = (e?: React.FormEvent) => {
    e?.preventDefault();
    const action = (needsRequest || preview.decision?.route === 'SEND_TO_APPROVER') ? 'SEND_REQUEST' : 'SUBMIT';
    void submitDispatch(action);
  };

  // --- Real-time Calculation & Presentation Computations ---
  const portionSummary = computePortionQuantitySummary(portions);
  const vehiclePortionComparison = computeVehiclePortionDifference(vehicleQuantity, portionSummary);

  const calculatedPortionsList = portions.map((p) => computeCalculatedMilkValues(p));
  const safeTotals = computeDispatchSafeSummaryTotals(calculatedPortionsList);

  if (result) {
    const sv = STATUS_VIEW[result.status] ?? STATUS_VIEW.DISPATCHED;
    const SvIcon = sv.Icon;
    return (
      <div className="max-w-2xl mx-auto space-y-6 py-6 px-4">
        <div className="p-6 bg-card rounded-2xl border border-border-strong shadow-xs text-center space-y-4">
          <div className="flex justify-center">
            <div className={`inline-flex items-center space-x-2 px-3 py-1.5 rounded-full border text-sm font-semibold ${sv.className}`}>
              <SvIcon className="w-4 h-4" />
              <span>{sv.word}</span>
            </div>
          </div>

          <div>
            <h2 className="text-xl font-bold text-foreground">Dispatch #{result.dispatchNumber}</h2>
            <p className="text-xs text-slate-500 mt-1">Vehicle: {vehicleNumber.trim().toUpperCase()}</p>
          </div>

          {result.status === 'PENDING_APPROVAL' && (
            <p className="text-xs font-semibold text-violet-900 bg-violet-50 border border-violet-200 rounded-xl p-3">
              This dispatch has out-of-spec test values or exceptions. A review request has been sent to the {result.approverLabel} for approval.
            </p>
          )}

          {result.totals && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2 text-left">
              <div className="bg-card border-border p-3 rounded-xl border">
                <div className="text-[11px] font-semibold text-slate-500 uppercase">Gross Litres</div>
                <div className="text-sm font-bold text-foreground tabular-nums mt-0.5">{fmtL(result.totals.grossLiters)}</div>
              </div>
              <div className="bg-card border-border p-3 rounded-xl border">
                <div className="text-[11px] font-semibold text-slate-500 uppercase">Avg LR</div>
                <div className="text-sm font-bold text-foreground tabular-nums mt-0.5">{fmt2(result.totals.weightedLr)}</div>
              </div>
              <div className="bg-card border-border p-3 rounded-xl border">
                <div className="text-[11px] font-semibold text-slate-500 uppercase">Avg Fat</div>
                <div className="text-sm font-bold text-foreground tabular-nums mt-0.5">{fmt2(result.totals.weightedFat)}%</div>
              </div>
              <div className="bg-card border-border p-3 rounded-xl border">
                <div className="text-[11px] font-semibold text-slate-500 uppercase">L @ 13 TS</div>
                <div className="text-sm font-bold text-foreground tabular-nums mt-0.5">{fmtL(result.totals.weightedTs13)}</div>
              </div>
            </div>
          )}

          {result.tankRemainingLiters !== null && (
            <div className="bg-card border-border p-3 rounded-xl border text-left flex items-center justify-between text-xs">
              <span className="font-semibold text-blue-900">Tank left:</span>
              <span className="font-bold text-blue-950 tabular-nums">{fmtL(result.tankRemainingLiters)}</span>
            </div>
          )}

          {uploadQueue.length > 0 && (
            <div className="bg-card border-border p-3 rounded-xl border text-left text-xs space-y-1">
              <div className="font-semibold text-slate-700 flex items-center space-x-1.5">
                {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
                <span>{uploading ? 'Uploading pictures…' : 'All pictures uploaded'}</span>
              </div>
              <p className="text-[11px] text-slate-500">
                {uploadQueue.length} photo(s) in queue
              </p>
            </div>
          )}

          <div className="pt-2">
            <button
              type="button"
              onClick={startNextDispatch}
              className="w-full min-h-[48px] px-4 py-3 rounded-xl bg-primary-hover text-white font-semibold text-sm shadow-xs hover:bg-blue-800 transition flex items-center justify-center space-x-2"
            >
              <Undo2 className="w-4 h-4" />
              <span>New dispatch</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmitDispatch} className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 p-4 sm:p-5 rounded-xl bg-card border border-border-strong shadow-xs">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded-xl bg-primary-hover text-white">
            <span className="font-semibold text-sm tabular-nums">MPD</span>
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="font-semibold text-base text-foreground">Milk dispatch</h2>
              {draftVisitId ? (
                <span className="text-xs tabular-nums font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
                  Draft
                </span>
              ) : (
                <span className="text-xs tabular-nums font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-primary-hover border border-blue-200">
                  New
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2 self-start sm:self-auto">
          {draftVisitId && (
            <button
              type="button"
              onClick={handleClearDraft}
              className="min-h-11 min-w-11 h-9 px-3 rounded-xl border border-rose-300 bg-rose-50 text-rose-800 text-xs font-semibold hover:bg-rose-100 transition"
            >
              Clear
            </button>
          )}

          <div className="bg-card border-border flex items-center space-x-2 px-3 py-1.5 rounded-xl border-strong">
            <span className="text-xs uppercase font-semibold text-slate-500">Source:</span>
            <span className="text-xs font-semibold text-primary-hover tabular-nums">
              {effectiveSource ? effectiveSource.name : (isSourceBound ? 'Loading source…' : 'None')}
            </span>
            <span className="text-xs font-semibold uppercase px-2 py-0.5 rounded bg-blue-100 text-blue-900 border border-blue-200">
              {effectiveSource?.source_type || '—'}
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-col lg:grid lg:grid-cols-12 gap-6 items-start">
        <div className="hidden lg:block lg:col-span-5 space-y-4 lg:sticky lg:top-4 self-start order-2 lg:order-1">
          <DispatchSummaryPanel
            isCollapsible={false}
            portions={portions}
            vehicleQuantity={vehicleQuantity}
            portionSummary={portionSummary}
            vehiclePortionComparison={vehiclePortionComparison}
            safeTotals={safeTotals}
            calculatedPortionsList={calculatedPortionsList}
            labTests={labTests}
          />
        </div>

        <div className="w-full lg:col-span-7 space-y-5 order-1 lg:order-2">
          <nav aria-label="Dispatch steps" className="grid grid-cols-2 gap-2">
            {(['1. Vehicle', '2. Portions'] as const).map((label, i) => (
              <button
                key={label}
                type="button"
                aria-current={formStep === i ? 'step' : undefined}
                onClick={() => {
                  if (i === 1 && formStep === 0) {
                    handleNextToPortions();
                  } else {
                    setFormStep(i as 0 | 1);
                  }
                }}
                className={`min-h-11 rounded-xl border text-sm font-semibold transition ${
                  formStep === i ? 'border-primary-hover bg-blue-50 text-primary-hover' : 'border-border text-slate-600 hover:bg-muted'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>

          <div className={formStep === 0 ? 'space-y-5 animate-in fade-in-0 slide-in-from-bottom-1 duration-200' : 'hidden'}>
          <DispatchVehicleSection
            isSourceBound={isSourceBound}
            availableSources={availableSources}
            selectedSourceId={selectedSourceId}
            onSelectSourceId={(id) => setSelectedSourceId(id)}
            vehicleNumber={vehicleNumber}
            onVehicleNumberChange={handleVehicleNumberChange}
            vehicleNumberError={vehicleNumberError}
            dispatchOpDatetime={dispatchOpDatetime}
            onDispatchOpDatetimeChange={(val) => setDispatchOpDatetime(val)}
            maxDatetime={toDatetimeLocalInput(new Date())}
            isPolicyReady={isPolicyReady}
            vehicleQuantity={vehicleQuantity}
            onVehicleQuantityValueChange={handleVehicleQuantityValueChange}
            onVehicleUnitChange={handleVehicleUnitChange}
            onVehicleBasisChange={handleVehicleBasisChange}
            vehicleAllowedUnits={vehicleAllowedUnits}
            vehicleAllowedBases={vehicleAllowedBases}
            vehicleQuantityError={vehicleQuantityError}
            sourceType={effectiveSource?.source_type}
            vehicleLr={vehicleLr}
            onVehicleLrChange={handleVehicleLrChange}
            vehicleFat={vehicleFat}
            onVehicleFatChange={handleVehicleFatChange}
            isVehicleQualityAuto={isVehicleQualityAuto}
            onResetVehicleQualityAuto={handleResetVehicleQualityAuto}
            rawMilkDispatchNoteNumber={rawMilkDispatchNoteNumber}
            onRawMilkDispatchNoteNumberChange={setRawMilkDispatchNoteNumber}
            isZmccSource={!isContractorSource}
            availableVehicles={availableVehicles}
            selectedVehicleId={selectedMotVehicleId}
            onSelectVehicle={handleSelectVehicle}
            availableMotProfiles={availableMotProfiles}
            selectedMotProfileId={selectedMotProfileId}
            onSelectMotProfileId={handleSelectMotProfile}
            motError={motError}
            driverName={driverName}
            onDriverNameChange={handleDriverNameChange}
            driverError={driverError}
            isLoadingResources={isLoadingResources}
          />

          </div>

          <div className={formStep === 1 ? 'space-y-5 animate-in fade-in-0 slide-in-from-bottom-1 duration-200' : 'hidden'}>
          {/* Test Mode Selector */}
          <div className="p-4 sm:p-5 rounded-xl bg-card border border-border-strong shadow-xs space-y-2">
            <label className="block text-xs font-semibold text-slate-700">Test mode</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => handleTestModeChange('COMPOSITE')}
                className={`px-3 py-2.5 rounded-xl border text-xs font-semibold flex flex-col items-center justify-center transition min-h-[44px] ${
                  testMode === 'COMPOSITE'
                    ? 'border-primary-hover bg-blue-50 text-primary-hover ring-2 ring-primary-hover/20'
                    : 'border-border text-slate-600 hover:bg-muted'
                }`}
              >
                <span>Composite</span>
                <span className="text-[10px] font-normal text-slate-500">One portion</span>
              </button>
              <button
                type="button"
                onClick={() => handleTestModeChange('PORTION_WISE')}
                className={`px-3 py-2.5 rounded-xl border text-xs font-semibold flex flex-col items-center justify-center transition min-h-[44px] ${
                  testMode === 'PORTION_WISE'
                    ? 'border-primary-hover bg-blue-50 text-primary-hover ring-2 ring-primary-hover/20'
                    : 'border-border text-slate-600 hover:bg-muted'
                }`}
              >
                <span>Portion-wise</span>
                <span className="text-[10px] font-normal text-slate-500">Per portion</span>
              </button>
            </div>
          </div>

          <DispatchPortionEditor
            portions={portions}
            editingPortionIndex={editingPortionIndex}
            onAddPortionClick={handleAddPortionClick}
            onCloseEditor={() => setEditingPortionIndex(null)}
            onEditPortion={handleEditPortion}
            onRemovePortion={handleRemovePortion}
            onSavePortion={handleSavePortion}
            onPortionQuantityValueChange={handlePortionQuantityValueChange}
            onPortionUnitChange={handlePortionUnitChange}
            onPortionBasisChange={handlePortionBasisChange}
            onTestResultChange={handleTestResultChange}
            portionAllowedMeasurements={portionAllowedMeasurements}
            portionAllowedUnits={portionAllowedUnits}
            portionErrors={portionErrors}
            testMode={testMode}
            sourceType={effectiveSource?.source_type}
            policyTests={policyTests}
            onSealChange={handleSealChange}
            onPhotoTaken={handlePortionPhotoTaken}
            onPhotoRemoved={handlePortionPhotoRemoved}
            stamp={stamp}
            isLoadingTests={isLoadingTests}
            getPortionProgress={getPortionProgress}
            computeCalculatedMilkValues={computeCalculatedMilkValues}
          />

          <LabReportPhotoCard
            photo={labReportPhoto}
            onPhotoChange={setLabReportPhoto}
            cameraOpen={labReportCamera}
            onCameraOpenChange={setLabReportCamera}
            stamp={stamp}
          />


          </div>

          <Drawer open={decideOpen} onOpenChange={setDecideOpen} dismissible={!isSubmitting}>
            <DrawerContent>
              <div className="border-b border-border px-4 pb-3 pt-2 sm:px-5">
                <DrawerTitle>Review and decide</DrawerTitle>
              </div>
              <div className="space-y-4 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5">
          <div>
            <DispatchSummaryPanel
              isCollapsible={true}
              portions={portions}
              vehicleQuantity={vehicleQuantity}
              portionSummary={portionSummary}
              vehiclePortionComparison={vehiclePortionComparison}
              safeTotals={safeTotals}
              calculatedPortionsList={calculatedPortionsList}
              labTests={labTests}
            />
          </div>

          {submitError && (
            <div className="bg-card border-border p-3.5 rounded-xl border text-rose-800 text-xs flex items-start space-x-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{submitError}</span>
            </div>
          )}

          {sealServerError && (
            <div className="bg-card border-border p-3.5 rounded-xl border text-amber-900 text-xs flex items-start space-x-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>{sealServerError}</span>
            </div>
          )}

          {reopenedNote && (
            <div className="bg-card border-border p-3.5 rounded-xl border text-amber-900 text-xs flex items-start space-x-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>{reopenedNote}</span>
            </div>
          )}

          {policyError && (
            <div className="bg-card border-border p-3.5 rounded-xl border text-amber-900 text-xs flex items-start space-x-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>{policyError}</span>
            </div>
          )}

          {/* Decision Rule Panel */}
          <div className="p-4 sm:p-5 rounded-xl bg-card border border-border-strong shadow-xs space-y-3.5">
            <DecisionRulePanel
              tests={preview.rows}
              decision={needsRequest ?? preview.decision}
              personDecision={personDecision}
              onPersonDecisionChange={(d) => {
                setPersonDecision(d);
                setNeedsRequest(null);
              }}
              remarks={decisionRemarks}
              onRemarksChange={(r) => {
                setDecisionRemarks(r);
                setNeedsRequest(null);
              }}
              warnings={preview.warnings}
              approverLabel={approverLabel}
              routeLabels={{
                PROCEED: `Submit (${vehicleQuantity.value ? `${vehicleQuantity.value} ${vehicleQuantity.unit}` : '—'})`,
                REJECT: 'Reject',
                SEND_TO_APPROVER: `Send to ${approverLabel}`,
                DECIDE_NOW: 'Decide now',
              }}
              onSubmit={() => handleSubmitDispatch()}
              submitting={isSubmitting}
              disabled={
                isSubmitting ||
                portions.length === 0 ||
                !vehicleNumber.trim() ||
                !vehicleQuantity.value ||
                Number(vehicleQuantity.value) <= 0
              }
            />
          </div>
              </div>
            </DrawerContent>
          </Drawer>

          {formStep !== 0 && showWarning && showWhy && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-xs text-amber-950">
              <div className="font-bold">{goesToApprover ? `Why this goes to ${approverLabel}` : 'Not ready yet'}</div>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
                {(whyLines.length > 0 ? whyLines : ['Something is outside the rules.']).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-stretch gap-2">
          {formStep !== 0 && showWarning && (
            <button
              type="button"
              onClick={() => setShowWhy((v) => !v)}
              aria-label="Show what needs attention"
              aria-expanded={showWhy}
              className="min-h-14 min-w-14 shrink-0 rounded-xl border border-amber-300 bg-amber-50 text-amber-600 flex items-center justify-center"
            >
              <AlertTriangle className="w-6 h-6" />
            </button>
          )}
          <button
            type="button"
            onClick={() => (formStep === 0 ? handleNextToPortions() : handleOpenDecide())}
            className={cn(
              'min-h-14 w-full rounded-xl text-base font-semibold text-white shadow-xs transition flex items-center justify-center gap-2',
              formStep === 0
                ? 'bg-primary-hover hover:bg-blue-800'
                : goesToApprover
                  ? 'bg-violet-700 hover:bg-violet-800'
                  : 'bg-primary-hover hover:bg-blue-800'
            )}
          >
            {formStep === 0 ? (
              'Next: Portions'
            ) : goesToApprover ? (
              <>
                <Send className="w-4 h-4" />
                <span>Review & Send Request to {approverLabel}</span>
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                <span>Dispatch</span>
              </>
            )}
          </button>
          </div>
        </div>
      </div>
    </form>
  );
};
