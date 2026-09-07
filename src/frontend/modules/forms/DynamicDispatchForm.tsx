'use client';

import React, { useState, useEffect, useRef } from 'react';
import { toDatetimeLocalInput, datetimeLocalToIso } from '@/lib/datetime-utils';
import { useToast } from '@/frontend/context/ToastContext';
import { User } from '@core/types';
import { getScopedDraftKey } from '@/lib/validations/dispatch';

import {
  QuantityUnit,
  MeasurementBasis,
  getAllowedUnits,
  getAllowedBases,
} from '@/backend/modules/dispatch/quantity-policy/types';
import {
  applySharedPortionUnit,
  applySharedPortionBasis,
  createPortionQuantityFromSharedProfile,
  computeDispatchPortionCalculatedValues,
  computePortionQuantitySummary,
  canUseMeasuredPortionTotalForVehicle,
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
  LabTestDef,
  TestResultState,
  PortionFormState,
} from './components/DispatchPortionEditor';
import { DispatchSummaryPanel } from './components/DispatchSummaryPanel';

export type { QuantityUnitType, MeasurementBasisType, QuantityState, LabTestDef, TestResultState, PortionFormState };

interface DynamicDispatchFormProps {
  currentUser: User | null;
  onSuccess?: () => void;
}

export const DynamicDispatchForm: React.FC<DynamicDispatchFormProps> = ({ currentUser, onSuccess }) => {
  const toast = useToast();
  const [labTests, setLabTests] = useState<LabTestDef[]>([]);
  const [isLoadingTests, setIsLoadingTests] = useState(false);

  const [availableSources, setAvailableSources] = useState<Array<{ id: string; name: string; source_type: string }>>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string>('');
  const [frozenQuantityPolicy, setFrozenQuantityPolicy] = useState<any>(null);

  // Vehicle Header Fields
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [vehicleNumberError, setVehicleNumberError] = useState<string | null>(null);
  const [dispatchOpDatetime, setDispatchOpDatetime] = useState<string>(toDatetimeLocalInput(new Date()));

  // Authoritative Vehicle Quantity State
  const [vehicleQuantity, setVehicleQuantity] = useState<QuantityState>({
    value: '',
    unit: 'KG',
    basis: 'MEASURED',
  });
  const [vehicleQuantityError, setVehicleQuantityError] = useState<string | null>(null);

  // Portions Draft State
  const [portions, setPortions] = useState<PortionFormState[]>([]);
  const [editingPortionIndex, setEditingPortionIndex] = useState<number | null>(0);

  // Per-portion inline errors state
  const [portionErrors, setPortionErrors] = useState<
    Record<number, { quantity?: string; tests?: Record<string, string> }>
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

  const isContractorSource = effectiveSource?.source_type === 'CONTRACTOR';

  // Fetch active sources for global users if needed
  useEffect(() => {
    // Safely remove legacy un-scoped singleton key from storage on mount
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('mpd_active_draft_visit_id');
    }

    async function loadSources() {
      if (!isSourceBound) {
        try {
          const res = await fetch('/api/super-admin/procurement-sources');
          const data = await res.json();
          if (data.sources) {
            setAvailableSources(data.sources);
            // Requirement A: Leave selectedSourceId empty initially; do NOT auto-select first source
          }
        } catch (err) {
          console.error('Failed to load procurement sources', err);
        }
      }
    }
    loadSources();
  }, [isSourceBound]);

  const buildInitialPortionResults = (tests: LabTestDef[], isContractor = isContractorSource): Record<
    string,
    TestResultState
  > => {
    const res: Record<string, TestResultState> = {};
    tests.forEach((t) => {
      const key = t.testId;
      res[key] = {
        numericValue: '',
        textValue: '',
        performanceStatus: isContractor ? 'NOT_PERFORMED' : 'PERFORMED',
        notPerformedReason: isContractor ? 'Contract Vehicle' : '',
      };
    });
    return res;
  };

  // Draft visit ID tracking
  const [draftVisitId, setDraftVisitId] = useState<string | null>(null);

  // Track in-flight initialization to avoid duplicate concurrent POSTs
  const inFlightInitRef = useRef<{ userId: string; sourceId: string } | null>(null);
  const initSeqRef = useRef(0);

  const initializeDispatchWorkItem = async (targetSourceId: string, forceNew = false) => {
    if (!currentUser || !targetSourceId) return;

    if (
      !forceNew &&
      inFlightInitRef.current?.userId === currentUser.id &&
      inFlightInitRef.current?.sourceId === targetSourceId
    ) {
      return;
    }

    inFlightInitRef.current = { userId: currentUser.id, sourceId: targetSourceId };
    const currentSeq = ++initSeqRef.current;
    setIsLoadingTests(true);

    const scopedKey = getScopedDraftKey(currentUser.id, targetSourceId);
    try {
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

      // If a newer initialization request began, ignore this outdated response
      if (initSeqRef.current !== currentSeq) {
        return;
      }

      if (data.assignedTests) {
        setDraftVisitId(data.visitId);
        if (data.quantityPolicy?.policy) {
          setFrozenQuantityPolicy(data.quantityPolicy);
          const vDef = data.quantityPolicy.policy.vehicleRules?.default;
          if (vDef) {
            setVehicleQuantity({
              value: '',
              unit: vDef.unit,
              basis: vDef.basis,
            });
          }
        }
        if (typeof window !== 'undefined' && data.visitId && scopedKey) {
          sessionStorage.setItem(scopedKey, data.visitId);
        }

        setLabTests(data.assignedTests);
        const isContractor = effectiveSource?.source_type === 'CONTRACTOR';
        const initialResults = buildInitialPortionResults(data.assignedTests, isContractor);

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
                results: initialResults,
                isSaved: false,
              },
            ]);
          }
        }
      }
    } catch (err: any) {
      if (initSeqRef.current === currentSeq) {
        toast.showError(err.message || 'Failed to initialize dispatch test catalog', 'Load Error');
      }
    } finally {
      if (inFlightInitRef.current?.userId === currentUser.id && inFlightInitRef.current?.sourceId === targetSourceId) {
        inFlightInitRef.current = null;
      }
      if (initSeqRef.current === currentSeq) {
        setIsLoadingTests(false);
      }
    }
  };

  useEffect(() => {
    if (effectiveSourceId) {
      initializeDispatchWorkItem(effectiveSourceId);
    }
  }, [effectiveSourceId]);

  // Derived options for vehicle and portions based on policy
  const isPolicyReady = !!frozenQuantityPolicy?.policy;

  // Vehicle Allowed Rules
  const vehicleAllowedMeasurements = frozenQuantityPolicy?.policy?.vehicleRules?.allowedMeasurements;
  const defaultUnits: QuantityUnit[] = ['KG', 'LITER'];
  const defaultBases: MeasurementBasis[] = ['MEASURED', 'ESTIMATED'];

  const vehicleAllowedUnits: QuantityUnit[] = isPolicyReady && vehicleAllowedMeasurements
    ? getAllowedUnits(vehicleAllowedMeasurements)
    : defaultUnits;

  const vehicleAllowedBases: MeasurementBasis[] = isPolicyReady && vehicleAllowedMeasurements && vehicleQuantity.unit
    ? getAllowedBases(vehicleAllowedMeasurements, vehicleQuantity.unit)
    : defaultBases;

  // Portion Allowed Rules
  const portionAllowedMeasurements = frozenQuantityPolicy?.policy?.portionRules?.allowedMeasurements;
  const portionAllowedUnits: QuantityUnit[] = isPolicyReady && portionAllowedMeasurements
    ? getAllowedUnits(portionAllowedMeasurements)
    : defaultUnits;

  const createFreshPortion = (portionNumber: number): PortionFormState => {
    const freshResults = buildInitialPortionResults(labTests, isContractorSource);
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
      results: freshResults,
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
    const bases = getAllowedBases(vehicleAllowedMeasurements, newUnit);
    const newBasis = bases.includes(vehicleQuantity.basis) ? vehicleQuantity.basis : bases[0];
    setVehicleQuantity((prev) => ({
      ...prev,
      unit: newUnit,
      basis: newBasis,
    }));
  };

  const handleVehicleBasisChange = (newBasis: MeasurementBasisType) => {
    setVehicleQuantity((prev) => ({
      ...prev,
      basis: newBasis,
    }));
  };

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

  const handlePerformanceStatusChange = (
    portionIndex: number,
    testId: string,
    status: 'PERFORMED' | 'NOT_PERFORMED'
  ) => {
    const updated = [...portions];
    const currentRes = updated[portionIndex].results[testId] || {
      numericValue: '',
      textValue: '',
      performanceStatus: 'PERFORMED',
      notPerformedReason: '',
    };

    updated[portionIndex].results[testId] = {
      ...currentRes,
      performanceStatus: status,
      // Reset opposite field when switching
      numericValue: status === 'NOT_PERFORMED' ? '' : currentRes.numericValue,
      textValue: status === 'NOT_PERFORMED' ? '' : currentRes.textValue,
      notPerformedReason: status === 'PERFORMED' ? '' : (currentRes.notPerformedReason || (isContractorSource ? 'Contract Vehicle' : '')),
    };
    setPortions(updated);

    // Clear error for this test if present
    if (portionErrors[portionIndex]?.tests?.[testId]) {
      setPortionErrors((prev) => {
        const testsCopy = { ...prev[portionIndex].tests };
        delete testsCopy[testId];
        return {
          ...prev,
          [portionIndex]: {
            ...prev[portionIndex],
            tests: testsCopy,
          },
        };
      });
    }
  };

  const handleTestResultChange = (
    portionIndex: number,
    testId: string,
    field: 'numericValue' | 'textValue' | 'notPerformedReason',
    value: string
  ) => {
    const updated = [...portions];
    const currentRes = updated[portionIndex].results[testId] || {
      numericValue: '',
      textValue: '',
      performanceStatus: 'PERFORMED',
      notPerformedReason: '',
    };

    const newRes = { ...currentRes, [field]: value };
    updated[portionIndex].results[testId] = newRes;
    setPortions(updated);

    // Clear error for this test if present and non-empty
    if (portionErrors[portionIndex]?.tests?.[testId] && value.trim().length > 0) {
      setPortionErrors((prev) => {
        const testsCopy = { ...prev[portionIndex].tests };
        delete testsCopy[testId];
        return {
          ...prev,
          [portionIndex]: {
            ...prev[portionIndex],
            tests: testsCopy,
          },
        };
      });
    }
  };

  const handleSavePortion = (index: number): boolean => {
    const target = portions[index];
    if (!target) return false;

    const errors: { quantity?: string; tests: Record<string, string> } = {
      tests: {},
    };
    let firstInvalidId: string | null = null;

    const qty = Number(target.quantity.value);
    const unitLabel = target.quantity.unit === 'LITER' ? 'L' : 'kg';
    if (!target.quantity.value || isNaN(qty) || qty <= 0) {
      errors.quantity = `Please enter a valid portion quantity (${unitLabel} > 0).`;
      if (!firstInvalidId) {
        firstInvalidId = `portion-qty-input-${index}`;
      }
    }

    const manualTests = labTests.filter((t) => t.resultType !== 'CALCULATED');
    manualTests.forEach((t) => {
      const res = target.results[t.testId];
      if (t.isRequired) {
        if (!res || !res.performanceStatus) {
          errors.tests[t.testId] = `${t.testName} performance status is required.`;
          if (!firstInvalidId) firstInvalidId = `test-input-field-${index}-${t.id}`;
        } else if (res.performanceStatus === 'PERFORMED') {
          if (t.resultType === 'NUMERIC') {
            const nVal = Number(res.numericValue);
            if (res.numericValue === '' || isNaN(nVal) || nVal < 0) {
              errors.tests[t.testId] = `${t.testName} requires a valid positive numeric observation.`;
              if (!firstInvalidId) firstInvalidId = `test-input-field-${index}-${t.id}`;
            }
          } else {
            if (!res.textValue || res.textValue.trim().length === 0) {
              errors.tests[t.testId] = `${t.testName} qualitative observation is required.`;
              if (!firstInvalidId) firstInvalidId = `test-input-field-${index}-${t.id}`;
            }
          }
        } else if (res.performanceStatus === 'NOT_PERFORMED') {
          if (!res.notPerformedReason || res.notPerformedReason.trim().length === 0) {
            errors.tests[t.testId] = `A reason must be provided when ${t.testName} is NOT PERFORMED.`;
            if (!firstInvalidId) firstInvalidId = `test-reason-field-${index}-${t.id}`;
          }
        }
      }
    });

    const hasErrors = !!errors.quantity || Object.keys(errors.tests).length > 0;
    if (hasErrors) {
      setPortionErrors((prev) => ({
        ...prev,
        [index]: errors,
      }));
      toast.showError('Please fix all portion errors before saving.', 'Portion Validation');

      if (firstInvalidId) {
        const el = document.getElementById(firstInvalidId);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.focus();
        }
      }
      return false;
    }

    // Clear errors and mark portion as saved
    setPortionErrors((prev) => {
      const updated = { ...prev };
      delete updated[index];
      return updated;
    });

    const updated = [...portions];
    updated[index].isSaved = true;
    setPortions(updated);
    setEditingPortionIndex(null);
    toast.showSuccess(`Portion ${target.portionNumber} validated and saved successfully.`);
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
      const newErrors: Record<number, { quantity?: string; tests?: Record<string, string> }> = {};
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

  const manualLabTests = labTests.filter((t) => t.resultType !== 'CALCULATED');

  const getPortionProgress = (portion: PortionFormState) => {
    const performedCount = manualLabTests.filter((t) => {
      const r = portion.results[t.testId];
      if (!r || r.performanceStatus !== 'PERFORMED') return false;
      return t.resultType === 'NUMERIC'
        ? r.numericValue !== '' && !isNaN(Number(r.numericValue))
        : !!r.textValue && r.textValue.trim().length > 0;
    }).length;

    const notPerformedCount = manualLabTests.filter((t) => {
      const r = portion.results[t.testId];
      return r && r.performanceStatus === 'NOT_PERFORMED' && !!r.notPerformedReason && r.notPerformedReason.trim().length > 0;
    }).length;

    const accounted = performedCount + notPerformedCount;
    const requiredManualTests = labTests.filter((t) => t.isRequired && t.resultType !== 'CALCULATED');
    const accountedRequired = requiredManualTests.filter((t) => {
      const r = portion.results[t.testId];
      if (!r) return false;
      if (r.performanceStatus === 'PERFORMED') {
        return t.resultType === 'NUMERIC'
          ? r.numericValue !== '' && !isNaN(Number(r.numericValue))
          : !!r.textValue && r.textValue.trim().length > 0;
      }
      return r.performanceStatus === 'NOT_PERFORMED' && !!r.notPerformedReason && r.notPerformedReason.trim().length > 0;
    }).length;

    const label = `${accountedRequired}/${requiredManualTests.length} Required Tests Accounted`;
    return { label, accounted, total: manualLabTests.length };
  };

  // Helper to compute live calculated milk metrics for a portion (Unit-Safe)
  const computeCalculatedMilkValues = (portion: PortionFormState) => {
    const lrTest = labTests.find(
      (t) => t.testName.toLowerCase().includes('lactometer') || t.testName.toLowerCase().includes('lr')
    );
    const fatTest = labTests.find(
      (t) =>
        t.testName.toLowerCase().includes('fat') &&
        !t.testName.toLowerCase().includes('ratio') &&
        !t.testName.toLowerCase().includes('snf')
    );

    const lrRes = lrTest ? portion.results[lrTest.testId] : null;
    const fatRes = fatTest ? portion.results[fatTest.testId] : null;

    const rawLr = lrRes && lrRes.performanceStatus === 'PERFORMED' ? lrRes.numericValue : '';
    const rawFat = fatRes && fatRes.performanceStatus === 'PERFORMED' ? fatRes.numericValue : '';

    return computeDispatchPortionCalculatedValues(
      portion.quantity.value,
      portion.quantity.unit,
      rawLr,
      rawFat
    );
  };

  const savedCount = portions.filter((p) => p.isSaved).length;

  const handleSubmitDispatch = async (e: React.FormEvent) => {
    e.preventDefault();

    // 1. Vehicle Number validation
    if (!vehicleNumber.trim()) {
      setVehicleNumberError('Vehicle Registration Number is required.');
      toast.showError('Please enter a vehicle registration number.', 'Validation Error');
      const el = document.getElementById('vehicle-number-input');
      if (el) el.focus();
      return;
    }

    // 2. Vehicle Quantity validation
    const vehQtyNum = Number(vehicleQuantity.value);
    if (!vehicleQuantity.value || isNaN(vehQtyNum) || vehQtyNum <= 0) {
      setVehicleQuantityError('A valid whole-vehicle dispatch quantity (> 0) is required.');
      toast.showError('Please enter a valid whole-vehicle dispatch quantity.', 'Validation Error');
      const el = document.getElementById('vehicle-quantity-input');
      if (el) el.focus();
      return;
    }

    // 3. Portions validation
    if (portions.length === 0) {
      toast.showError('At least one milk portion is required to dispatch.', 'Portions Required');
      return;
    }

    // If a portion is currently being edited, attempt to save it
    if (editingPortionIndex !== null) {
      const savedSuccess = handleSavePortion(editingPortionIndex);
      if (!savedSuccess) return;
    }

    const currentSavedCount = portions.filter((p) => p.isSaved).length;
    if (currentSavedCount !== portions.length) {
      toast.showError('All portions must be validated and saved before submitting dispatch.', 'Unsaved Portions');
      return;
    }

    setIsSubmitting(true);

    try {
      const isoDispatchTimestamp = datetimeLocalToIso(dispatchOpDatetime) || undefined;

      const payloadPortions = portions.map((p) => {
        return {
          portionNumber: p.portionNumber,
          quantity: {
            value: Number(p.quantity.value),
            unit: p.quantity.unit,
            basis: p.quantity.basis,
          },
          dispatchTimestamp: isoDispatchTimestamp,
          results: labTests
            .filter((t) => t.resultType !== 'CALCULATED')
            .map((t) => {
              const res = p.results[t.testId] || {
                numericValue: '',
                textValue: '',
                performanceStatus: isContractorSource ? 'NOT_PERFORMED' : 'PERFORMED',
                notPerformedReason: isContractorSource ? 'Contract Vehicle' : '',
              };

              return {
                testId: t.testId,
                performanceStatus: res.performanceStatus,
                notPerformedReason:
                  res.performanceStatus === 'NOT_PERFORMED'
                    ? res.notPerformedReason?.trim() || 'Contract Vehicle'
                    : null,
                numericValue:
                  res.performanceStatus === 'PERFORMED' && t.resultType === 'NUMERIC'
                    ? res.numericValue !== ''
                      ? Number(res.numericValue)
                      : null
                    : null,
                textValue:
                  res.performanceStatus === 'PERFORMED' && t.resultType !== 'NUMERIC'
                    ? res.textValue
                      ? res.textValue.trim()
                      : null
                    : null,
              };
            }),
        };
      });

      // Determine testing mode
      let allPerformed = true;
      let allNotPerformed = true;
      for (const p of payloadPortions) {
        for (const r of p.results) {
          if (r.performanceStatus === 'PERFORMED') {
            allNotPerformed = false;
          } else {
            allPerformed = false;
          }
        }
      }

      let dispatchTestingMode: 'FULL' | 'PARTIAL' | 'NOT_PERFORMED' = 'PARTIAL';
      if (allNotPerformed) {
        dispatchTestingMode = 'NOT_PERFORMED';
      } else if (allPerformed) {
        dispatchTestingMode = 'FULL';
      }

      if (!effectiveSource || !effectiveSource.id) {
        toast.showError('Please select a valid procurement source before submitting.', 'Validation Error');
        setIsSubmitting(false);
        return;
      }

      if (!draftVisitId) {
        toast.showError('Dispatch draft is not initialized. Please select a procurement source.', 'Validation Error');
        setIsSubmitting(false);
        return;
      }

      if (!isPolicyReady) {
        toast.showError('Quantity policy snapshot is still loading. Please wait before submitting.', 'Validation Error');
        setIsSubmitting(false);
        return;
      }

      const effectiveDispatchDate = isoDispatchTimestamp || new Date().toISOString();

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
          dispatchTestingReason: isContractorSource && allNotPerformed ? 'Contract Vehicle' : null,
          vehicleQuantity: {
            value: Number(vehicleQuantity.value),
            unit: vehicleQuantity.unit,
            basis: vehicleQuantity.basis,
          },
          portions: payloadPortions,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit dispatch');
      }

      toast.showSuccess(
        `Dispatch record created successfully. Visit #${data.visit?.visit_number || draftVisitId?.slice(0, 8)}`,
        'Dispatch Recorded'
      );

      // Clean up scoped draft key on success
      const scopedKey = getScopedDraftKey(currentUser?.id, effectiveSourceId);
      if (scopedKey && typeof window !== 'undefined') {
        sessionStorage.removeItem(scopedKey);
      }
      setDraftVisitId(null);

      // Reset form fields
      setVehicleNumber('');
      setVehicleQuantity((prev) => ({ ...prev, value: '' }));
      setPortions([]);
      setEditingPortionIndex(null);

      if (onSuccess) {
        onSuccess();
      }

      // Re-initialize for next work item
      if (effectiveSourceId) {
        initializeDispatchWorkItem(effectiveSourceId, true);
      }
    } catch (err: any) {
      toast.showError(err.message || 'An error occurred while submitting dispatch', 'Submission Error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClearDraft = () => {
    const scopedKey = getScopedDraftKey(currentUser?.id, effectiveSourceId);
    if (scopedKey && typeof window !== 'undefined') {
      sessionStorage.removeItem(scopedKey);
    }
    setDraftVisitId(null);
    setVehicleNumber('');
    setVehicleQuantity((prev) => ({ ...prev, value: '' }));
    setEditingPortionIndex(0);

    toast.showInfo('Draft cleared. Initializing fresh dispatch work item...');
    if (effectiveSourceId) {
      initializeDispatchWorkItem(effectiveSourceId, true);
    }
  };

  // --- Real-time Calculation & Presentation Computations ---
  const portionSummary = computePortionQuantitySummary(portions);
  const isEligibleForAssistance = canUseMeasuredPortionTotalForVehicle(vehicleQuantity, portionSummary);
  const vehiclePortionComparison = computeVehiclePortionDifference(vehicleQuantity, portionSummary);

  const calculatedPortionsList = portions.map((p) => computeCalculatedMilkValues(p));
  const safeTotals = computeDispatchSafeSummaryTotals(calculatedPortionsList);

  return (
    <form onSubmit={handleSubmitDispatch} className="space-y-6">
      {/* Top Header Card with Operating Source & Draft Badge */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 p-4 sm:p-5 rounded-2xl bg-white border border-[#C4B9A3] shadow-sm">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded-xl bg-[#1E40AF] text-white">
            <span className="font-extrabold text-sm font-mono">MPD</span>
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="font-black text-base text-[#111311]">Field Milk Dispatch</h2>
              {draftVisitId ? (
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
                  Draft Restored
                </span>
              ) : (
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-blue-100 text-[#1E40AF] border border-blue-200">
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
              className="h-9 px-3 rounded-xl border border-rose-300 bg-rose-50 text-rose-800 text-xs font-bold hover:bg-rose-100 transition"
            >
              Clear Draft
            </button>
          )}

          <div className="flex items-center space-x-2 bg-[#F4EFE3] px-3 py-1.5 rounded-xl border border-[#C4B9A3]">
            <span className="text-[10px] uppercase font-bold text-slate-500">Source:</span>
            <span className="text-xs font-black text-[#1E40AF] font-mono">
              {effectiveSource ? effectiveSource.name : (isSourceBound ? 'Loading source...' : 'None Selected')}
            </span>
            <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-blue-100 text-blue-900 border border-blue-200">
              {effectiveSource?.source_type || '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Main 2-Column Responsive Workspace */}
      <div className="flex flex-col lg:grid lg:grid-cols-12 gap-6 items-start">
        {/* DESKTOP LEFT COLUMN (5/12): STICKY DISPATCH & PORTIONS SUMMARY (hidden on mobile, rendered inline on mobile) */}
        <div className="hidden lg:block lg:col-span-5 space-y-4 lg:sticky lg:top-4 self-start order-2 lg:order-1">
          <DispatchSummaryPanel
            isCollapsible={false}
            portions={portions}
            vehicleQuantity={vehicleQuantity}
            portionSummary={portionSummary}
            isEligibleForAssistance={isEligibleForAssistance}
            vehiclePortionComparison={vehiclePortionComparison}
            onApplyAssistedQuantity={(totalValue) => {
              handleVehicleQuantityValueChange(totalValue);
            }}
            safeTotals={safeTotals}
            calculatedPortionsList={calculatedPortionsList}
            labTests={labTests}
          />
        </div>

        {/* WORKING FORM COLUMN (7/12 on Desktop, Full-width on Mobile) */}
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
          />

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
            onPerformanceStatusChange={handlePerformanceStatusChange}
            onTestResultChange={handleTestResultChange}
            portionAllowedMeasurements={portionAllowedMeasurements}
            portionAllowedUnits={portionAllowedUnits}
            portionErrors={portionErrors}
            isContractorSource={isContractorSource}
            manualLabTests={manualLabTests}
            isLoadingTests={isLoadingTests}
            getPortionProgress={getPortionProgress}
            computeCalculatedMilkValues={computeCalculatedMilkValues}
          />

          {/* Mobile Collapsible Summary Panel (Rendered here below portions on mobile/tablet) */}
          <div className="block lg:hidden">
            <DispatchSummaryPanel
              isCollapsible={true}
              portions={portions}
              vehicleQuantity={vehicleQuantity}
              portionSummary={portionSummary}
              isEligibleForAssistance={isEligibleForAssistance}
              vehiclePortionComparison={vehiclePortionComparison}
              onApplyAssistedQuantity={(totalValue) => {
                handleVehicleQuantityValueChange(totalValue);
              }}
              safeTotals={safeTotals}
              calculatedPortionsList={calculatedPortionsList}
              labTests={labTests}
            />
          </div>

          {/* Final Dispatch Summary & Submission Footer */}
          <div className="p-4 sm:p-5 rounded-2xl bg-white border border-[#C4B9A3] shadow-sm space-y-3.5">
            <div className="flex items-center justify-between text-xs font-extrabold text-[#111311]">
              <span>
                Portions: <span className="font-mono text-[#1E40AF]">{portions.length}</span> ({savedCount} Saved)
              </span>
              <span>
                Vehicle Quantity:{' '}
                <span className="font-mono text-[#1E40AF]">
                  {vehicleQuantity.value ? `${vehicleQuantity.value} ${vehicleQuantity.unit}` : '—'}
                </span>
              </span>
            </div>

            <button
              type="submit"
              disabled={
                isSubmitting ||
                savedCount === 0 ||
                editingPortionIndex !== null ||
                !vehicleNumber.trim() ||
                !vehicleQuantity.value ||
                Number(vehicleQuantity.value) <= 0
              }
              className="w-full h-12 flex items-center justify-center py-3 px-4 rounded-xl bg-[#1E40AF] text-white font-extrabold text-sm shadow-md hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {isSubmitting
                ? 'Submitting Dispatch...'
                : `Submit Dispatch (${
                    vehicleQuantity.value ? `${vehicleQuantity.value} ${vehicleQuantity.unit}` : '—'
                  })`}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
};
