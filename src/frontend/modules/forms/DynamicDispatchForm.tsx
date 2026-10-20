'use client';

import React, { useState, useEffect, useRef, useEffectEvent, useMemo } from 'react';
import { AlertTriangle, Camera, CheckCircle2, Clock, Loader2, RefreshCw, Trash2, XCircle } from 'lucide-react';
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
import { LiveCamera } from '@/components/camera/LiveCamera';
import { DecisionRulePanel } from '@/frontend/modules/shared/decision/DecisionRulePanel';
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
function computeAutoVehicleQuality(portions: PortionFormState[], labTests: LabTestDef[]): { lr: string; fat: string } {
  const lrTest = labTests.find(
    (t) => t.testName.toLowerCase().includes('lactometer') || t.testName.toLowerCase().includes('lr')
  );
  const fatTest = labTests.find(
    (t) =>
      t.testName.toLowerCase().includes('fat') &&
      !t.testName.toLowerCase().includes('ratio') &&
      !t.testName.toLowerCase().includes('snf')
  );

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

  const lr =
    totalQty > 0 && weightedLrSum > 0
      ? (weightedLrSum / totalQty).toFixed(2)
      : validLrCount > 0
        ? (simpleLrSum / validLrCount).toFixed(2)
        : '';
  const fat =
    totalQty > 0 && weightedFatSum > 0
      ? (weightedFatSum / totalQty).toFixed(2)
      : validFatCount > 0
        ? (simpleFatSum / validFatCount).toFixed(2)
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

  let res = await fetch('/api/dispatches/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      visitId: savedDraftId || undefined,
      procurementSourceId: targetSourceId,
    }),
  });

  let data = await res.json();

  // Stale draft recovery: if saved draft is invalid (404/400/403), remove stale key and create fresh draft
  if (!res.ok && savedDraftId && (res.status === 404 || res.status === 400 || res.status === 403)) {
    if (scopedKey && typeof window !== 'undefined') {
      sessionStorage.removeItem(scopedKey);
    }
    res = await fetch('/api/dispatches/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        procurementSourceId: targetSourceId,
      }),
    });
    data = await res.json();
  }

  if (!res.ok) {
    throw new Error(data.error || 'Failed to start dispatch work item');
  }
  return data;
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
  DISPATCHED: { word: 'Dispatched', className: 'border-green-300 bg-green-50 text-green-800', Icon: CheckCircle2 },
  PENDING_APPROVAL: { word: 'Waiting for approval', className: 'border-violet-300 bg-violet-50 text-violet-900', Icon: Clock },
  REOPENED: { word: 'Sent back to you', className: 'border-amber-300 bg-amber-50 text-amber-900', Icon: AlertTriangle },
  REJECTED: { word: 'Rejected', className: 'border-red-300 bg-red-50 text-red-800', Icon: XCircle },
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
  const [editingPortionIndex, setEditingPortionIndex] = useState<number | null>(0);

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
  // Preview only: the server decides again. Superiors decide on the same screen (Super Admin / Data Executive are outside the rule).
  const deciderCanApprove = isContractorSource
    ? roleLabel === 'CONTRACTOR_MANAGER' || roleLabel === 'HEAD_OF_MPD'
    : roleLabel === 'ZMCC_MANAGER' || roleLabel === 'HEAD_OF_MPD';

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
            const list = sourceType
              ? data.sources.filter((s: { source_type: string }) => s.source_type === sourceType)
              : data.sources;
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

  // --- Handlers for Vehicle Quantity ---
  const handleVehicleNumberChange = (val: string) => {
    setVehicleNumber(val);
    if (vehicleNumberError && val.trim().length > 0) {
      setVehicleNumberError(null);
    }
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
  const autoVehicleQuality = isVehicleQualityAuto ? computeAutoVehicleQuality(portions, labTests) : null;
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
    if (mode === testMode) return;
    if (mode === 'COMPOSITE' && portions.length > 1) {
      if (typeof window !== 'undefined' && !window.confirm('Switching to Composite mode records all tests under Portion 1. Any additional portions will be removed. Continue?')) {
        return;
      }
      setPortions((prev) => prev.slice(0, 1));
      setEditingPortionIndex(null);
    }
    setTestMode(mode);
    setNeedsRequest(null);
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
    const done = compulsory.filter((t) => isFilled(portion, t)).length;
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
      test_results: policyTests
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
      toast.showError('Composite test mode requires all tests recorded under 1 single portion.', 'Check the form');
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
    if (!personDecision) {
      toast.showError('Tap ACCEPT or REJECT first.', 'Your decision');
      return;
    }
    if (!effectiveSource?.id || !draftVisitId || !policy || !policyPoint) {
      toast.showError('The form is still loading. Please wait a moment.', 'Please wait');
      return;
    }
    if (preview.decision && !preview.decision.remarksOk) {
      toast.showError('Please write a short reason (at least 3 letters).', 'Reason needed');
      return;
    }

    setIsSubmitting(true);
    try {
      const isoDispatchTimestamp = datetimeLocalToIso(dispatchOpDatetime) || undefined;
      const payloadPortions = buildPayloadPortions(isoDispatchTimestamp);
      const anyTested = payloadPortions.some((p) => p.test_results.length > 0);
      const allTested = policyTests
        .filter((t) => t.testMode === 'COMPULSORY')
        .every((t) => payloadPortions.every((p) => p.test_results.some((x) => x.lab_test_id === t.labTestId)));
      const dispatchTestingMode: 'FULL' | 'PARTIAL' | 'NOT_PERFORMED' = !anyTested ? 'NOT_PERFORMED' : allTested ? 'FULL' : 'PARTIAL';

      let finalVehicleLr = vehicleLr;
      let finalVehicleFat = vehicleFat;
      if (!finalVehicleLr || !finalVehicleFat) {
        const auto = computeAutoVehicleQuality(portions, labTests);
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
          testMode,
          action,
          personDecision,
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
        <div className="p-6 bg-white rounded-2xl border border-border-strong shadow-xs text-center space-y-4">
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

          {result.totals && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2 text-left">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-[11px] font-semibold text-slate-500 uppercase">Gross Litres</div>
                <div className="text-sm font-bold text-foreground tabular-nums mt-0.5">{fmtL(result.totals.grossLiters)}</div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-[11px] font-semibold text-slate-500 uppercase">Weighted LR</div>
                <div className="text-sm font-bold text-foreground tabular-nums mt-0.5">{fmt2(result.totals.weightedLr)}</div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-[11px] font-semibold text-slate-500 uppercase">Weighted Fat</div>
                <div className="text-sm font-bold text-foreground tabular-nums mt-0.5">{fmt2(result.totals.weightedFat)}%</div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-[11px] font-semibold text-slate-500 uppercase">13% TS Litres</div>
                <div className="text-sm font-bold text-foreground tabular-nums mt-0.5">{fmtL(result.totals.weightedTs13)}</div>
              </div>
            </div>
          )}

          {result.tankRemainingLiters !== null && (
            <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-left flex items-center justify-between text-xs">
              <span className="font-semibold text-blue-900">Remaining Tank Balance:</span>
              <span className="font-bold text-blue-950 tabular-nums">{fmtL(result.tankRemainingLiters)}</span>
            </div>
          )}

          {uploadQueue.length > 0 && (
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-left text-xs space-y-1">
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
              <RefreshCw className="w-4 h-4" />
              <span>Start Next Dispatch</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmitDispatch} className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 p-4 sm:p-5 rounded-xl bg-white border border-border-strong shadow-xs">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded-xl bg-primary-hover text-white">
            <span className="font-semibold text-sm tabular-nums">MPD</span>
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="font-semibold text-base text-foreground">Field Milk Dispatch</h2>
              {draftVisitId ? (
                <span className="text-xs tabular-nums font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
                  Draft Restored
                </span>
              ) : (
                <span className="text-xs tabular-nums font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-primary-hover border border-blue-200">
                  New Work Item
                </span>
              )}
            </div>
            <p className="text-xs text-slate-600 font-medium">
              Authoritative whole-vehicle measurement & dynamic composite portions
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2 self-start sm:self-auto">
          {draftVisitId && (
            <button
              type="button"
              onClick={handleClearDraft}
              className="h-9 px-3 rounded-xl border border-rose-300 bg-rose-50 text-rose-800 text-xs font-semibold hover:bg-rose-100 transition"
            >
              Clear Draft
            </button>
          )}

          <div className="flex items-center space-x-2 bg-muted px-3 py-1.5 rounded-xl border border-border-strong">
            <span className="text-xs uppercase font-semibold text-slate-500">Source:</span>
            <span className="text-xs font-semibold text-primary-hover tabular-nums">
              {effectiveSource ? effectiveSource.name : (isSourceBound ? 'Loading source…' : 'None Selected')}
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
          />

          {/* Test Mode Selector */}
          <div className="p-4 sm:p-5 rounded-xl bg-white border border-border-strong shadow-xs space-y-2">
            <label className="block text-xs font-semibold text-slate-700">Dispatch Test Mode</label>
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
                <span className="text-[10px] font-normal text-slate-500">1 single portion</span>
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
                <span className="text-[10px] font-normal text-slate-500">Separate portions</span>
              </button>
            </div>
          </div>

          <DispatchPortionEditor
            portions={portions}
            editingPortionIndex={editingPortionIndex}
            onAddPortionClick={handleAddPortionClick}
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

          {/* Hand-written Lab Report Photo */}
          <div className="p-4 sm:p-5 rounded-xl bg-white border border-border-strong shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-semibold text-foreground">Hand-written Lab Report Photo</h4>
                <p className="text-[11px] text-slate-500">Paper lab report photo required for dispatch record</p>
              </div>
              {labReportPhoto && (
                <button
                  type="button"
                  onClick={() => {
                    if (labReportPhoto) URL.revokeObjectURL(labReportPhoto.previewUrl);
                    setLabReportPhoto(null);
                  }}
                  className="text-xs text-rose-600 hover:text-rose-800 flex items-center space-x-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Retake</span>
                </button>
              )}
            </div>

            {labReportPhoto ? (
              <div className="flex items-center space-x-3 p-2.5 rounded-xl bg-emerald-50 border border-emerald-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={labReportPhoto.previewUrl}
                  alt="Lab Report"
                  className="w-16 h-16 object-cover rounded-lg border border-emerald-300"
                />
                <div className="text-xs">
                  <div className="font-semibold text-emerald-900 flex items-center space-x-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Lab report photo captured</span>
                  </div>
                  <div className="text-[11px] text-emerald-700 mt-0.5">
                    {new Date(labReportPhoto.capturedAt).toLocaleTimeString()}
                  </div>
                </div>
              </div>
            ) : labReportCamera ? (
              <LiveCamera
                stamp={{ ...stamp, pointLabel: `${stamp.pointLabel} - Lab Report` }}
                onCapture={(c) => {
                  setLabReportPhoto(toPhotoState(c));
                  setLabReportCamera(false);
                }}
                onCancel={() => setLabReportCamera(false)}
              />
            ) : (
              <button
                type="button"
                onClick={() => setLabReportCamera(true)}
                className="w-full min-h-[48px] px-4 py-2.5 rounded-xl border border-dashed border-border-strong hover:border-primary-hover bg-slate-50 hover:bg-blue-50/50 text-xs font-semibold text-slate-700 flex items-center justify-center space-x-2 transition"
              >
                <Camera className="w-4 h-4 text-primary-hover" />
                <span>Take Hand-written Lab Report Photo</span>
              </button>
            )}
          </div>

          <div className="block lg:hidden">
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
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-300 text-rose-800 text-xs flex items-start space-x-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{submitError}</span>
            </div>
          )}

          {sealServerError && (
            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs flex items-start space-x-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>{sealServerError}</span>
            </div>
          )}

          {reopenedNote && (
            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs flex items-start space-x-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>{reopenedNote}</span>
            </div>
          )}

          {policyError && (
            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs flex items-start space-x-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>{policyError}</span>
            </div>
          )}

          {/* Decision Rule Panel */}
          <div className="p-4 sm:p-5 rounded-xl bg-white border border-border-strong shadow-xs space-y-3.5">
            <div className="flex items-center justify-between text-xs font-semibold text-foreground">
              <span>
                Portions: <span className="tabular-nums text-primary-hover">{portions.length}</span> ({savedCount} Saved)
              </span>
              <span>
                Vehicle Quantity:{' '}
                <span className="tabular-nums text-primary-hover">
                  {vehicleQuantity.value ? `${vehicleQuantity.value} ${vehicleQuantity.unit}` : '—'}
                </span>
              </span>
            </div>

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
                PROCEED: `Submit Dispatch (${vehicleQuantity.value ? `${vehicleQuantity.value} ${vehicleQuantity.unit}` : '—'})`,
                REJECT: 'Reject Dispatch',
                SEND_TO_APPROVER: `Send request to ${approverLabel}`,
                DECIDE_NOW: 'Decide & Dispatch Now',
              }}
              onSubmit={() => handleSubmitDispatch()}
              submitting={isSubmitting}
              disabled={
                isSubmitting ||
                savedCount === 0 ||
                editingPortionIndex !== null ||
                !vehicleNumber.trim() ||
                !vehicleQuantity.value ||
                Number(vehicleQuantity.value) <= 0
              }
            />
          </div>
        </div>
      </div>
    </form>
  );
};
