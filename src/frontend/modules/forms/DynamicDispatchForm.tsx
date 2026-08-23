'use client';

import React, { useState, useEffect, useRef } from 'react';
import { toDatetimeLocalInput, datetimeLocalToIso } from '@/lib/datetime-utils';
import { PlusCircle, Check, Clock, Calculator } from 'lucide-react';
import { useToast } from '@/frontend/context/ToastContext';
import { QualitativeResultRadioGroup } from '@/frontend/modules/shared/QualitativeResultRadioGroup';
import { User } from '@core/types';
import {
  calculateSNF,
  calculateTS,
  calculateRatio,
  calculateDensity,
  calculatePhysicalLiters,
  calculateAt13TSLiters,
  calculateEquivalentKgFromLiters,
} from '@/backend/utils/milkFormulas';
import { getScopedDraftKey } from '@/lib/validations/dispatch';

import {
  QuantityUnit,
  MeasurementBasis,
  MeasurementMethod,
  DispatchQuantityPolicySnapshotDTO,
  getAllowedUnits,
  getAllowedBases,
  getAllowedMethods,
} from '@/backend/modules/dispatch/quantity-policy/types';

interface LabTestDef {
  id: string;
  testId: string;
  testCode: string;
  testName: string;
  resultType: 'NUMERIC' | 'TEXT' | 'QUALITATIVE' | 'BOOLEAN' | 'OK_NOT_OK' | 'POSITIVE_NEGATIVE' | 'CALCULATED' | string;
  unit: string | null;
  isRequired: boolean;
  displayOrder: number;
  resultOptions?: Array<{ value: string; label: string; isPassing: boolean | null }> | null;
}

interface TestResultState {
  numericValue: string;
  textValue: string;
  performanceStatus: 'PERFORMED' | 'NOT_PERFORMED';
  notPerformedReason: string;
}

export type QuantityUnitType = QuantityUnit;
export type MeasurementBasisType = MeasurementBasis;
export type MeasurementMethodType = MeasurementMethod;

export interface QuantityState {
  value: string;
  unit: QuantityUnit;
  basis: MeasurementBasis;
  method: MeasurementMethod;
}

interface PortionFormState {
  clientId: string;
  portionNumber: number;
  quantity: QuantityState;
  results: Record<string, TestResultState>;
  isSaved: boolean;
}

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
    method: 'WEIGHING',
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
        } catch (_err) {
          // Fallback handled silently
        }
      }
    }
    loadSources();
  }, [isSourceBound]);

  const buildInitialPortionResults = (tests: LabTestDef[], isContractor = isContractorSource): Record<string, TestResultState> => {
    const results: Record<string, TestResultState> = {};

    tests.forEach((t) => {
      const key = t.testId;
      if (isContractor) {
        // Contractor Default: NOT_PERFORMED (Contract Vehicle)
        results[key] = {
          numericValue: '',
          textValue: '',
          performanceStatus: 'NOT_PERFORMED',
          notPerformedReason: 'Contract Vehicle',
        };
      } else {
        // ZMCC Dispatch: Initialized as PERFORMED without claiming automatic results
        results[key] = {
          numericValue: '',
          textValue: '',
          performanceStatus: 'PERFORMED',
          notPerformedReason: '',
        };
      }
    });

    return results;
  };

  const [draftVisitId, setDraftVisitId] = useState<string | null>(null);
  const inFlightInitRef = useRef<{ userId: string; sourceId: string } | null>(null);
  const initSeqRef = useRef(0);

  const initializeDispatchWorkItem = async (targetSourceId: string, forceNew = false) => {
    if (!targetSourceId || !currentUser?.id) {
      setIsLoadingTests(false);
      return;
    }

    // Requirement B: In-flight deduplication guard for same user + source context
    if (!forceNew && inFlightInitRef.current && inFlightInitRef.current.userId === currentUser.id && inFlightInitRef.current.sourceId === targetSourceId) {
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
              method: vDef.method,
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
                  method: pDef.method,
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

  // Wait for authoritative user and source context before initializing
  useEffect(() => {
    if (currentUser?.id && effectiveSourceId) {
      initializeDispatchWorkItem(effectiveSourceId);
    } else {
      setIsLoadingTests(false);
    }
  }, [currentUser?.id, effectiveSourceId]);

  // Explicit frozen-policy readiness condition
  const isPolicyReady = !!frozenQuantityPolicy?.policy;

  // Derived allowed options for Vehicle (strictly guarded against undefined)
  const vehicleAllowedMeasurements = frozenQuantityPolicy?.policy?.vehicleRules?.allowedMeasurements;
  const vehicleAllowedUnits = isPolicyReady && vehicleAllowedMeasurements ? getAllowedUnits(vehicleAllowedMeasurements) : [];
  const vehicleAllowedBases = isPolicyReady && vehicleAllowedMeasurements && vehicleQuantity.unit
    ? getAllowedBases(vehicleAllowedMeasurements, vehicleQuantity.unit)
    : [];
  const vehicleAllowedMethods = isPolicyReady && vehicleAllowedMeasurements && vehicleQuantity.unit && vehicleQuantity.basis
    ? getAllowedMethods(vehicleAllowedMeasurements, vehicleQuantity.unit, vehicleQuantity.basis)
    : [];

  // Derived allowed options for Portion (strictly guarded against undefined)
  const portionAllowedMeasurements = frozenQuantityPolicy?.policy?.portionRules?.allowedMeasurements;
  const portionAllowedUnits = isPolicyReady && portionAllowedMeasurements ? getAllowedUnits(portionAllowedMeasurements) : [];

  const createFreshPortion = (portionNumber: number): PortionFormState => {
    const freshResults = buildInitialPortionResults(labTests, isContractorSource);
    const pDef = frozenQuantityPolicy?.policy?.portionRules?.default;
    if (!pDef) {
      throw new Error('Cannot create portion: frozen quantity policy snapshot is not loaded.');
    }

    const clientId =
      typeof window !== 'undefined' && window.crypto?.randomUUID
        ? window.crypto.randomUUID()
        : `portion-${Date.now()}-${portionNumber}`;

    return {
      clientId,
      portionNumber,
      quantity: {
        value: '',
        unit: pDef.unit,
        basis: pDef.basis,
        method: pDef.method,
      },
      results: freshResults,
      isSaved: false,
    };
  };

  const handleVehicleNumberChange = (val: string) => {
    setVehicleNumber(val);
    if (val.trim()) {
      setVehicleNumberError(null);
    }
  };

  const handleVehicleQuantityValueChange = (val: string) => {
    setVehicleQuantity((prev) => ({ ...prev, value: val }));
    if (val && Number(val) > 0) {
      setVehicleQuantityError(null);
    }
  };

  const handleVehicleUnitChange = (newUnit: QuantityUnitType) => {
    const bases = getAllowedBases(vehicleAllowedMeasurements, newUnit);
    const newBasis = bases.includes(vehicleQuantity.basis) ? vehicleQuantity.basis : bases[0];
    const methods = getAllowedMethods(vehicleAllowedMeasurements, newUnit, newBasis);
    const newMethod = methods.includes(vehicleQuantity.method) ? vehicleQuantity.method : methods[0];

    setVehicleQuantity({
      value: '', // clear entered quantity on unit change
      unit: newUnit,
      basis: newBasis,
      method: newMethod,
    });
    setVehicleQuantityError(null);
  };

  const handleVehicleBasisChange = (newBasis: MeasurementBasisType) => {
    const methods = getAllowedMethods(vehicleAllowedMeasurements, vehicleQuantity.unit, newBasis);
    const newMethod = methods.includes(vehicleQuantity.method) ? vehicleQuantity.method : methods[0];
    setVehicleQuantity((prev) => ({
      ...prev,
      basis: newBasis,
      method: newMethod,
    }));
  };

  const handleVehicleMethodChange = (newMethod: MeasurementMethodType) => {
    setVehicleQuantity((prev) => ({ ...prev, method: newMethod }));
  };

  const handlePortionQuantityValueChange = (index: number, val: string) => {
    const updated = [...portions];
    updated[index].quantity.value = val;
    setPortions(updated);

    if (val && Number(val) > 0) {
      setPortionErrors((prev) => {
        if (!prev[index]?.quantity) return prev;
        const copy = { ...prev[index] };
        delete copy.quantity;
        return { ...prev, [index]: copy };
      });
    }
  };

  const handlePortionUnitChange = (index: number, newUnit: QuantityUnitType) => {
    const updated = [...portions];
    const currentPortion = updated[index];
    const bases = getAllowedBases(portionAllowedMeasurements, newUnit);
    const newBasis = bases.includes(currentPortion.quantity.basis) ? currentPortion.quantity.basis : bases[0];
    const methods = getAllowedMethods(portionAllowedMeasurements, newUnit, newBasis);
    const newMethod = methods.includes(currentPortion.quantity.method) ? currentPortion.quantity.method : methods[0];

    updated[index].quantity = {
      value: '', // clear entered quantity on unit change
      unit: newUnit,
      basis: newBasis,
      method: newMethod,
    };
    setPortions(updated);

    setPortionErrors((prev) => {
      if (!prev[index]?.quantity) return prev;
      const copy = { ...prev[index] };
      delete copy.quantity;
      return { ...prev, [index]: copy };
    });
  };

  const handlePortionBasisChange = (index: number, newBasis: MeasurementBasisType) => {
    const updated = [...portions];
    const currentPortion = updated[index];
    const methods = getAllowedMethods(portionAllowedMeasurements, currentPortion.quantity.unit, newBasis);
    const newMethod = methods.includes(currentPortion.quantity.method) ? currentPortion.quantity.method : methods[0];

    updated[index].quantity.basis = newBasis;
    updated[index].quantity.method = newMethod;
    setPortions(updated);
  };

  const handlePortionMethodChange = (index: number, newMethod: MeasurementMethodType) => {
    const updated = [...portions];
    updated[index].quantity.method = newMethod;
    setPortions(updated);
  };

  const handleAddPortionClick = () => {
    if (editingPortionIndex !== null) {
      const currentEditing = portions[editingPortionIndex];
      if (currentEditing && (!currentEditing.quantity.value || Number(currentEditing.quantity.value) <= 0)) {
        toast.showError(`Please enter a valid quantity for Portion ${currentEditing.portionNumber} before adding another.`, 'Validation Error');
        return;
      }
    }

    const nextNum = portions.length + 1;
    const newPortion = createFreshPortion(nextNum);
    const updated = [...portions, newPortion];
    setPortions(updated);
    setEditingPortionIndex(updated.length - 1);
  };

  const handlePerformanceStatusChange = (
    portionIndex: number,
    testId: string,
    newStatus: 'PERFORMED' | 'NOT_PERFORMED'
  ) => {
    const updated = [...portions];
    const currentRes = updated[portionIndex].results[testId] || {
      numericValue: '',
      textValue: '',
      performanceStatus: isContractorSource ? 'NOT_PERFORMED' : 'PERFORMED',
      notPerformedReason: isContractorSource ? 'Contract Vehicle' : '',
    };

    if (newStatus === 'PERFORMED') {
      updated[portionIndex].results[testId] = {
        ...currentRes,
        performanceStatus: 'PERFORMED',
        notPerformedReason: '', // Clear reason from active state
        // Genuine result required - no fake default
      };
    } else {
      updated[portionIndex].results[testId] = {
        ...currentRes,
        performanceStatus: 'NOT_PERFORMED',
        numericValue: '', // Clear numeric result
        textValue: '',    // Clear categorical result
        notPerformedReason: currentRes.notPerformedReason?.trim() || (isContractorSource ? 'Contract Vehicle' : 'Testing not performed at dispatch'),
      };
    }

    setPortions(updated);

    // Clear inline errors for this test on status change
    setPortionErrors((prev) => {
      if (!prev[portionIndex]?.tests?.[testId]) return prev;
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
  };

  const handleTestResultChange = (
    portionIndex: number,
    testId: string,
    field: keyof TestResultState,
    value: string
  ) => {
    const updated = [...portions];
    const currentRes = updated[portionIndex].results[testId] || {
      numericValue: '',
      textValue: '',
      performanceStatus: isContractorSource ? 'NOT_PERFORMED' : 'PERFORMED',
      notPerformedReason: isContractorSource ? 'Contract Vehicle' : '',
    };

    const newRes = { ...currentRes, [field]: value };

    // For ZMCC select dropdowns that include NOT_PERFORMED option
    if (!isContractorSource && field === 'textValue') {
      if (value === 'NOT_PERFORMED') {
        newRes.performanceStatus = 'NOT_PERFORMED';
        newRes.textValue = '';
        if (!newRes.notPerformedReason) {
          newRes.notPerformedReason = 'Testing not performed at dispatch';
        }
      } else {
        newRes.performanceStatus = 'PERFORMED';
        newRes.notPerformedReason = '';
      }
    }

    updated[portionIndex].results[testId] = newRes;
    setPortions(updated);

    setPortionErrors((prev) => {
      if (!prev[portionIndex]?.tests?.[testId]) return prev;
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
  };

  const handleSavePortion = (index: number): boolean => {
    const target = portions[index];
    if (!target) return false;

    const errors: { quantity?: string; tests: Record<string, string> } = { tests: {} };
    let firstInvalidId: string | null = null;

    // 1. Portion Quantity Validation (strictly positive)
    const qty = Number(target.quantity.value);
    const unitLabel = target.quantity.unit === 'LITER' ? 'L' : 'kg';
    if (!target.quantity.value || isNaN(qty) || qty <= 0) {
      errors.quantity = `Enter a quantity greater than 0 ${unitLabel}.`;
      if (!firstInvalidId) {
        firstInvalidId = `portion-qty-input-${index}`;
      }
    }

    // 2. Lab Test Validation for all manual tests
    const manualTests = labTests.filter((t) => t.resultType !== 'CALCULATED');

    for (const testDef of manualTests) {
      const res = target.results[testDef.testId];

      if (!res) {
        errors.tests[testDef.testId] = `Status for ${testDef.testName} is required.`;
        if (!firstInvalidId) firstInvalidId = `test-input-field-${index}-${testDef.id}`;
      } else if (res.performanceStatus === 'NOT_PERFORMED') {
        if (!res.notPerformedReason || !res.notPerformedReason.trim()) {
          errors.tests[testDef.testId] = `Reason required for unperformed test ${testDef.testName}.`;
          if (!firstInvalidId) {
            firstInvalidId = isContractorSource
              ? `test-reason-field-${index}-${testDef.id}`
              : `test-input-field-${index}-${testDef.id}`;
          }
        }
      } else if (res.performanceStatus === 'PERFORMED') {
        if (testDef.resultType === 'NUMERIC') {
          if (res.numericValue === '' || isNaN(Number(res.numericValue)) || Number(res.numericValue) < 0) {
            errors.tests[testDef.testId] = `Enter a valid numeric value for ${testDef.testName}.`;
            if (!firstInvalidId) firstInvalidId = `test-input-field-${index}-${testDef.id}`;
          }
        } else {
          if (!res.textValue || res.textValue.trim() === '' || res.textValue === 'NOT_PERFORMED') {
            errors.tests[testDef.testId] = `Result for ${testDef.testName} is required.`;
            if (!firstInvalidId) firstInvalidId = `test-input-field-${index}-${testDef.id}`;
          }
        }
      }
    }

    const hasErrors = !!errors.quantity || Object.keys(errors.tests).length > 0;

    if (hasErrors) {
      setPortionErrors((prev) => ({ ...prev, [index]: errors }));
      toast.showError(`Please fix validation errors in Portion ${target.portionNumber}.`, 'Validation Error');

      if (firstInvalidId) {
        const targetId = firstInvalidId;
        setTimeout(() => {
          const el = document.getElementById(targetId);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.focus();
          }
        }, 50);
      }
      return false;
    }

    // Success: Clear inline errors for this portion and mark isSaved = true
    setPortionErrors((prev) => {
      const updated = { ...prev };
      delete updated[index];
      return updated;
    });

    const updated = [...portions];
    updated[index] = { ...target, isSaved: true };
    setPortions(updated);
    setEditingPortionIndex(null);
    toast.showSuccess(`Portion ${target.portionNumber} saved successfully.`, 'Portion Saved');
    return true;
  };

  const handleEditPortion = (index: number) => {
    setEditingPortionIndex(index);
  };

  const handleRemovePortion = (index: number) => {
    if (portions.length <= 1) {
      toast.showError('A vehicle dispatch must contain at least one portion.', 'Validation Error');
      return;
    }

    const updated = portions.filter((_, i) => i !== index).map((p, i) => ({
      ...p,
      portionNumber: i + 1,
    }));

    setPortions(updated);

    setPortionErrors((prev) => {
      const nextErrors: Record<number, { quantity?: string; tests?: Record<string, string> }> = {};
      Object.keys(prev).forEach((keyStr) => {
        const k = Number(keyStr);
        if (k < index) nextErrors[k] = prev[k];
        else if (k > index) nextErrors[k - 1] = prev[k];
      });
      return nextErrors;
    });

    if (editingPortionIndex === index) {
      setEditingPortionIndex(null);
    } else if (editingPortionIndex !== null && editingPortionIndex > index) {
      setEditingPortionIndex(editingPortionIndex - 1);
    }
  };

  const manualLabTests = labTests.filter((t) => t.resultType !== 'CALCULATED');

  // Completeness counter helper: Handles ZMCC vs Contractor Modes
  const getPortionProgress = (portion: PortionFormState) => {
    if (isContractorSource) {
      const manualLabTests = labTests.filter((t) => t.resultType !== 'CALCULATED');
      const performedCount = manualLabTests.filter((t) => {
        const res = portion.results[t.testId];
        return res?.performanceStatus === 'PERFORMED' && (
          t.resultType === 'NUMERIC'
            ? res.numericValue !== '' && !isNaN(Number(res.numericValue))
            : res.textValue !== '' && res.textValue !== null && res.textValue !== undefined
        );
      }).length;

      const notPerformedCount = manualLabTests.filter((t) => {
        const res = portion.results[t.testId];
        return res?.performanceStatus === 'NOT_PERFORMED' && !!res.notPerformedReason?.trim();
      }).length;

      return {
        isContractor: true,
        performedCount,
        notPerformedCount,
        total: manualLabTests.length,
        label: `${performedCount} PERFORMED, ${notPerformedCount} NOT_PERFORMED (${manualLabTests.length} tests)`,
      };
    }

    // ZMCC Strict Mode
    const requiredManualTests = labTests.filter((t) => t.isRequired && t.resultType !== 'CALCULATED');
    const accountedCount = requiredManualTests.filter((t) => {
      const res = portion.results[t.testId];
      if (!res) return false;
      if (res.performanceStatus === 'NOT_PERFORMED') return !!res.notPerformedReason;
      if (t.resultType === 'NUMERIC') return res.numericValue !== '' && !isNaN(Number(res.numericValue));
      return res.textValue !== '' && res.textValue !== null && res.textValue !== undefined;
    }).length;

    return {
      completed: accountedCount,
      total: requiredManualTests.length,
      label: `${accountedCount} of ${requiredManualTests.length} required tests accounted for`,
    };
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
    const rawDeclared = Number(portion.quantity.value);

    const lrNum = rawLr !== '' && rawLr !== undefined && !isNaN(Number(rawLr)) ? Number(rawLr) : null;
    const fatNum = rawFat !== '' && rawFat !== undefined && !isNaN(Number(rawFat)) ? Number(rawFat) : null;
    const qtyNum = !isNaN(rawDeclared) && rawDeclared > 0 ? rawDeclared : null;
    const unit = portion.quantity.unit;

    let snfVal: number | null = null;
    let tsVal: number | null = null;
    let ratioVal: number | null = null;
    let densityVal: number | null = null;
    let physicalLitersVal: number | null = null;
    let at13TsLitersVal: number | null = null;

    if (lrNum !== null) {
      densityVal = calculateDensity(lrNum);
    }

    if (lrNum !== null && fatNum !== null) {
      snfVal = calculateSNF(lrNum, fatNum);
      tsVal = calculateTS(fatNum, snfVal);
      ratioVal = calculateRatio(snfVal, fatNum);
    }

    if (qtyNum !== null) {
      if (unit === 'KG') {
        if (lrNum !== null) {
          physicalLitersVal = calculatePhysicalLiters(qtyNum, lrNum);
        }
      } else if (unit === 'LITER') {
        physicalLitersVal = qtyNum;
      }

      if (physicalLitersVal !== null && tsVal !== null) {
        at13TsLitersVal = calculateAt13TSLiters(physicalLitersVal, tsVal);
      }
    }

    return {
      declaredVal: qtyNum,
      unit,
      snf: snfVal,
      ts: tsVal,
      ratio: ratioVal,
      density: densityVal,
      physicalLiters: physicalLitersVal,
      at13TsLiters: at13TsLitersVal,
    };
  };

  const savedCount = portions.filter((p) => p.isSaved).length;

  const handleSubmitDispatch = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!vehicleNumber.trim()) {
      setVehicleNumberError('Vehicle No. is required.');
      toast.showError('Vehicle No. is required.', 'Validation Error');
      const el = document.getElementById('vehicle-number-input');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.focus();
      }
      return;
    }

    const vehQtyNum = Number(vehicleQuantity.value);
    if (!vehicleQuantity.value || isNaN(vehQtyNum) || vehQtyNum <= 0) {
      setVehicleQuantityError('Valid vehicle dispatch quantity greater than 0 is required.');
      toast.showError('Please enter a valid Vehicle Dispatch Quantity.', 'Validation Error');
      const el = document.getElementById('vehicle-quantity-input');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.focus();
      }
      return;
    }

    // Auto-save open editing portion if valid
    if (editingPortionIndex !== null) {
      const savedSuccess = handleSavePortion(editingPortionIndex);
      if (!savedSuccess) return;
    }

    const currentSavedCount = portions.filter((p) => p.isSaved).length;
    if (currentSavedCount === 0) {
      toast.showError('Please save at least one portion before submitting dispatch.', 'Validation Error');
      return;
    }

    setIsSubmitting(true);

    const isoDispatchTimestamp = datetimeLocalToIso(dispatchOpDatetime) || undefined;

    const payloadPortions = portions.map((p) => {
      return {
        portionNumber: p.portionNumber,
        quantity: {
          value: p.quantity.value,
          unit: p.quantity.unit,
          basis: p.quantity.basis,
          method: p.quantity.method,
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
              notPerformedReason: res.performanceStatus === 'NOT_PERFORMED' ? (res.notPerformedReason?.trim() || 'Contract Vehicle') : null,
              numericValue:
                res.performanceStatus === 'PERFORMED' && t.resultType === 'NUMERIC'
                  ? res.numericValue !== '' ? Number(res.numericValue) : null
                  : null,
              textValue:
                res.performanceStatus === 'PERFORMED' && t.resultType !== 'NUMERIC'
                  ? res.textValue ? res.textValue.trim() : null
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
      return;
    }

    if (!draftVisitId) {
      toast.showError('Dispatch draft is not initialized. Please select a procurement source.', 'Validation Error');
      return;
    }

    if (!isPolicyReady) {
      toast.showError('Quantity policy snapshot is still loading. Please wait before submitting.', 'Validation Error');
      return;
    }

    try {
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
            value: vehicleQuantity.value,
            unit: vehicleQuantity.unit,
            basis: vehicleQuantity.basis,
            method: vehicleQuantity.method,
          },
          portions: payloadPortions,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit dispatch');

      // Clear scoped draft token and reset Form with fresh assignment for next dispatch
      const scopedKey = getScopedDraftKey(currentUser?.id, effectiveSourceId);
      if (typeof window !== 'undefined' && scopedKey) {
        sessionStorage.removeItem(scopedKey);
      }
      setDraftVisitId(null);
      setVehicleNumber('');
      setVehicleNumberError(null);
      setVehicleQuantityError(null);
      setPortionErrors({});
      setEditingPortionIndex(0);

      if (effectiveSourceId) {
        await initializeDispatchWorkItem(effectiveSourceId, true);
      }

      if (onSuccess) onSuccess();
    } catch (err: any) {
      toast.showError(err.message || 'Failed to submit dispatch', 'Dispatch Error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmitDispatch} className="p-6 rounded-2xl bg-[#EFE9D9] border border-[#C4B9A3] shadow-sm space-y-5 text-[#111311]">
      <div className="pb-2 border-b border-[#C4B9A3] flex items-center justify-between">
        <h2 className="text-lg font-extrabold text-[#111311]">New Dispatch</h2>

        {/* Read-Only Source Identity Block for Source-Bound Operators */}
        <div className="flex items-center space-x-2 bg-[#F4EFE3] px-3 py-1.5 rounded-xl border border-[#C4B9A3]">
          <span className="text-[10px] uppercase font-bold text-slate-500">Procurement Source:</span>
          <span className="text-xs font-black text-[#1E40AF] font-mono">
            {effectiveSource ? effectiveSource.name : (isSourceBound ? 'Loading source...' : 'None Selected')}
          </span>
          <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-blue-100 text-blue-900 border border-blue-200">
            Type: {effectiveSource?.source_type || '—'}
          </span>
        </div>
      </div>

      {/* Global Source Selector if user is NOT source-bound (e.g. Admin) */}
      {!isSourceBound && availableSources.length > 0 && (
        <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs space-y-1">
          <label className="block font-bold text-amber-900">Select Operating Procurement Source (Admin Override):</label>
          <select
            value={selectedSourceId}
            onChange={(e) => setSelectedSourceId(e.target.value)}
            className="w-full px-3 py-1.5 font-bold rounded-lg border border-amber-300 bg-white text-slate-900"
          >
            <option value="">-- Select Procurement Source --</option>
            {availableSources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.source_type})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Notice when unbound admin has not yet selected a source */}
      {!isSourceBound && !selectedSourceId && (
        <div className="p-3.5 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-xs font-semibold">
          Please select an operating procurement source from the dropdown above to initialize the dispatch draft.
        </div>
      )}

      {/* Vehicle Header Fields */}
      <div className="p-3.5 rounded-xl bg-[#F4EFE3] border border-[#C4B9A3] space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-bold mb-1">Vehicle No. *</label>
            <input
              id="vehicle-number-input"
              type="text"
              value={vehicleNumber}
              onChange={(e) => handleVehicleNumberChange(e.target.value)}
              placeholder="e.g. KBL-8492"
              className={`w-full px-3 py-2 text-sm font-mono font-bold rounded-xl border bg-white text-[#111311] focus:ring-2 focus:ring-[#1E40AF] outline-none ${
                vehicleNumberError ? 'border-rose-500 bg-rose-50/20 ring-1 ring-rose-500' : 'border-[#C4B9A3]'
              }`}
              required
            />
            {vehicleNumberError && (
              <p className="text-xs font-bold text-rose-600 mt-1" id="vehicle-number-error">
                {vehicleNumberError}
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold mb-1 flex items-center justify-between">
              <span>Dispatch Time *</span>
              <Clock className="w-3.5 h-3.5 text-[#1E40AF]" />
            </label>
            <input
              type="datetime-local"
              value={dispatchOpDatetime}
              max={toDatetimeLocalInput(new Date())}
              onChange={(e) => setDispatchOpDatetime(e.target.value)}
              className="w-full px-3 py-2 text-xs font-mono font-bold rounded-xl border border-[#C4B9A3] bg-white text-[#111311] focus:ring-2 focus:ring-[#1E40AF] outline-none"
              required
            />
          </div>
        </div>
      </div>

      {/* Vehicle Dispatch Quantity Section */}
      <div className="p-3.5 rounded-xl bg-[#F4EFE3] border border-[#C4B9A3] space-y-2.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-extrabold uppercase tracking-wider text-[#111311]">
            Vehicle Dispatch Quantity *
          </label>
          <span className="text-[10px] font-bold text-slate-500">
            Authoritative Vehicle Measurement
          </span>
        </div>

        {!isPolicyReady ? (
          <div className="p-3 text-center rounded-xl bg-white border border-dashed border-[#C4B9A3] text-xs font-semibold text-slate-500">
            Loading frozen quantity policy snapshot...
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
              <div>
                <label className="block text-[11px] font-bold mb-1">Value *</label>
                <input
                  id="vehicle-quantity-input"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={vehicleQuantity.value}
                  onChange={(e) => handleVehicleQuantityValueChange(e.target.value)}
                  placeholder="e.g. 19500"
                  className={`w-full px-3 py-2 text-sm font-mono font-bold rounded-xl border bg-white text-[#111311] focus:ring-2 focus:ring-[#1E40AF] outline-none ${
                    vehicleQuantityError ? 'border-rose-500 bg-rose-50/20 ring-1 ring-rose-500' : 'border-[#C4B9A3]'
                  }`}
                  required
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold mb-1">Unit *</label>
                <select
                  value={vehicleQuantity.unit}
                  onChange={(e) => handleVehicleUnitChange(e.target.value as QuantityUnitType)}
                  className="w-full px-3 py-2 text-xs font-mono font-black rounded-xl border border-[#C4B9A3] bg-white text-[#111311] focus:ring-2 focus:ring-[#1E40AF] outline-none"
                >
                  {vehicleAllowedUnits.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold mb-1">Basis *</label>
                <select
                  value={vehicleQuantity.basis}
                  onChange={(e) => handleVehicleBasisChange(e.target.value as MeasurementBasisType)}
                  className="w-full px-3 py-2 text-xs font-mono font-bold rounded-xl border border-[#C4B9A3] bg-white text-[#111311] focus:ring-2 focus:ring-[#1E40AF] outline-none"
                >
                  {vehicleAllowedBases.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold mb-1">Measurement Method *</label>
                <select
                  value={vehicleQuantity.method}
                  onChange={(e) => handleVehicleMethodChange(e.target.value as MeasurementMethodType)}
                  className="w-full px-3 py-2 text-xs font-mono font-bold rounded-xl border border-[#C4B9A3] bg-white text-[#111311] focus:ring-2 focus:ring-[#1E40AF] outline-none"
                >
                  {vehicleAllowedMethods.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {vehicleQuantityError && (
              <p className="text-xs font-bold text-rose-600 mt-1" id="vehicle-quantity-error">
                {vehicleQuantityError}
              </p>
            )}
          </>
        )}
      </div>

      {/* Milk Portions Section */}
      <div className="space-y-3 pt-1">
        <div className="flex items-center justify-between">
          <label className="text-xs font-extrabold uppercase tracking-wider text-[#111311]">
            Milk Portions
          </label>

          {editingPortionIndex === null && (
            <button
              type="button"
              onClick={handleAddPortionClick}
              className="flex items-center space-x-1 px-3 py-1.5 rounded-xl bg-[#1E40AF] text-white text-xs font-bold shadow-sm hover:bg-blue-800 transition"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>+ Add Portion</span>
            </button>
          )}
        </div>

        {/* Render Saved Portion Summary Cards & Active Expanded Editor */}
        <div className="space-y-3">
          {portions.map((portion, index) => {
            const isEditing = editingPortionIndex === index;
            const progress = getPortionProgress(portion);
            const calcValues = computeCalculatedMilkValues(portion);

            // Collapsed Summary Card View for Saved Portions
            if (!isEditing && portion.isSaved) {
              return (
                <div
                  key={`portion-card-${portion.clientId}`}
                  className="p-3.5 rounded-xl bg-[#F4EFE3] border border-[#C4B9A3] shadow-sm space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="p-1.5 rounded-full bg-emerald-100 text-emerald-800">
                        <Check className="w-4 h-4 stroke-[3]" />
                      </div>
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="font-extrabold text-sm text-[#111311]">Portion {portion.portionNumber}</span>
                          <span className="px-2 py-0.5 rounded text-xs font-black bg-blue-100 text-[#1E40AF] font-mono">
                            {portion.quantity.value ? `${Number(portion.quantity.value).toLocaleString()} ${portion.quantity.unit}` : '—'}
                          </span>
                          <span className="text-[10px] font-bold text-slate-500">
                            ({portion.quantity.basis} • {portion.quantity.method})
                          </span>
                        </div>
                        <p className="text-[11px] font-bold text-slate-600 mt-0.5">
                          {progress.label}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
                      <button
                        type="button"
                        onClick={() => handleEditPortion(index)}
                        className="px-2.5 py-1 rounded-lg bg-white border border-[#C4B9A3] text-xs font-bold text-[#1E40AF] hover:bg-blue-50"
                      >
                        Edit
                      </button>

                      {portions.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemovePortion(index)}
                          className="px-2.5 py-1 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 text-xs font-bold"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Calculated Milk Summary Strip */}
                  <div className="grid grid-cols-4 gap-2 pt-1 border-t border-[#C4B9A3] text-[10px] font-mono font-bold text-slate-700">
                    <div>
                      <span className="text-[9px] font-sans text-slate-500 block">SNF %</span>
                      <span>{calcValues.snf !== null ? `${calcValues.snf.toFixed(2)}%` : '—'}</span>
                    </div>
                    <div>
                      <span className="text-[9px] font-sans text-slate-500 block">TS %</span>
                      <span>{calcValues.ts !== null ? `${calcValues.ts.toFixed(2)}%` : '—'}</span>
                    </div>
                    <div>
                      <span className="text-[9px] font-sans text-slate-500 block">Physical Liters</span>
                      <span>{calcValues.physicalLiters !== null ? `${Math.round(calcValues.physicalLiters).toLocaleString()} L` : '—'}</span>
                    </div>
                    <div>
                      <span className="text-[9px] font-sans text-slate-500 block">13 TS</span>
                      <span>{calcValues.at13TsLiters !== null ? `${Math.round(calcValues.at13TsLiters).toLocaleString()} L` : '—'}</span>
                    </div>
                  </div>
                </div>
              );
            }

            // Expanded Portion Editor View
            if (isEditing) {
              const pAllowedBases = getAllowedBases(portionAllowedMeasurements, portion.quantity.unit);
              const pAllowedMethods = getAllowedMethods(portionAllowedMeasurements, portion.quantity.unit, portion.quantity.basis);
              const portionLabel = portion.quantity.basis === 'ESTIMATED' ? 'Estimated Portion Quantity' : 'Measured Portion Quantity';

              return (
                <div
                  key={`portion-editor-${portion.clientId}`}
                  className="p-4 rounded-2xl bg-white border-2 border-[#1E40AF] shadow-md space-y-4"
                >
                  <div className="flex items-center justify-between border-b pb-2">
                    <span className="font-extrabold text-sm text-[#1E40AF]">
                      Portion {portion.portionNumber}
                    </span>
                    <span className="text-xs font-bold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-full border border-slate-200">
                      {progress.label}
                    </span>
                  </div>

                  {/* Portion Quantity & Controls */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-bold text-[#111311]">
                        {portionLabel} *
                      </label>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-600 mb-1">Value *</label>
                        <input
                          id={`portion-qty-input-${index}`}
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={portion.quantity.value}
                          onChange={(e) => handlePortionQuantityValueChange(index, e.target.value)}
                          placeholder="e.g. 8500"
                          className={`w-full px-3 py-2 text-sm font-mono font-bold rounded-xl border bg-[#F4EFE3] text-[#111311] focus:ring-2 focus:ring-[#1E40AF] outline-none ${
                            portionErrors[index]?.quantity
                              ? 'border-rose-500 bg-rose-50/20 ring-1 ring-rose-500'
                              : 'border-[#C4B9A3]'
                          }`}
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-slate-600 mb-1">Unit *</label>
                        <select
                          value={portion.quantity.unit}
                          onChange={(e) => handlePortionUnitChange(index, e.target.value as QuantityUnitType)}
                          className="w-full px-3 py-2 text-xs font-mono font-black rounded-xl border border-[#C4B9A3] bg-white text-[#111311] focus:ring-2 focus:ring-[#1E40AF] outline-none"
                        >
                          {portionAllowedUnits.map((u) => (
                            <option key={u} value={u}>
                              {u}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-slate-600 mb-1">Basis *</label>
                        <select
                          value={portion.quantity.basis}
                          onChange={(e) => handlePortionBasisChange(index, e.target.value as MeasurementBasisType)}
                          className="w-full px-3 py-2 text-xs font-mono font-bold rounded-xl border border-[#C4B9A3] bg-white text-[#111311] focus:ring-2 focus:ring-[#1E40AF] outline-none"
                        >
                          {pAllowedBases.map((b) => (
                            <option key={b} value={b}>
                              {b}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-slate-600 mb-1">Method *</label>
                        <select
                          value={portion.quantity.method}
                          onChange={(e) => handlePortionMethodChange(index, e.target.value as MeasurementMethodType)}
                          className="w-full px-3 py-2 text-xs font-mono font-bold rounded-xl border border-[#C4B9A3] bg-white text-[#111311] focus:ring-2 focus:ring-[#1E40AF] outline-none"
                        >
                          {pAllowedMethods.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {portionErrors[index]?.quantity && (
                      <p className="text-xs font-bold text-rose-600 mt-1" id={`portion-qty-error-${index}`}>
                        {portionErrors[index].quantity}
                      </p>
                    )}
                  </div>

                  {/* Contractor Dispatch Tests Grid (Explicit Performance Status) */}
                  {isContractorSource ? (
                    <div className="space-y-3 pt-1 border-t border-slate-100">
                      <div className="flex items-center justify-between">
                        <label className="block text-xs font-extrabold uppercase text-[#111311]">
                          Contractor Dispatch Tests ({manualLabTests.length} Tests)
                        </label>
                        <span className="text-[10px] font-bold text-slate-500">
                          Default: NOT_PERFORMED (Contract Vehicle)
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                        {manualLabTests.map((test) => {
                          const resultState = portion.results[test.testId] || {
                            numericValue: '',
                            textValue: '',
                            performanceStatus: 'PERFORMED',
                            notPerformedReason: '',
                          };
                          const testError = portionErrors[index]?.tests?.[test.testId];
                          const isPerformed = resultState.performanceStatus === 'PERFORMED';

                          return (
                            <div
                              key={`contractor-test-${portion.clientId}-${test.id}`}
                              className={`p-2.5 rounded-xl border space-y-2 transition ${
                                testError
                                  ? 'border-rose-500 bg-rose-50/30 ring-1 ring-rose-400'
                                  : isPerformed
                                  ? 'border-[#C4B9A3] bg-[#F4EFE3]'
                                  : 'border-slate-300 bg-slate-100/70'
                              }`}
                            >
                              <div className="flex items-center justify-between text-xs font-bold">
                                <span className="text-[#111311] font-extrabold">
                                  {test.testName}
                                </span>
                                {test.unit && (
                                  <span className="text-[10px] font-mono text-slate-500">({test.unit})</span>
                                )}
                              </div>

                              {/* Performance Status Toggle */}
                              <div className="flex items-center space-x-1.5">
                                <button
                                  type="button"
                                  onClick={() => handlePerformanceStatusChange(index, test.testId, 'PERFORMED')}
                                  className={`px-2.5 py-1 rounded-lg text-[10.5px] font-black transition ${
                                    isPerformed
                                      ? 'bg-[#1E40AF] text-white shadow-sm'
                                      : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                                  }`}
                                >
                                  PERFORMED
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handlePerformanceStatusChange(index, test.testId, 'NOT_PERFORMED')}
                                  className={`px-2.5 py-1 rounded-lg text-[10.5px] font-black transition ${
                                    !isPerformed
                                      ? 'bg-rose-700 text-white shadow-sm'
                                      : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                                  }`}
                                >
                                  NOT PERFORMED
                                </button>
                              </div>

                              {/* Dynamic Input Control: Result when PERFORMED, Reason when NOT_PERFORMED */}
                              {isPerformed ? (
                                <div className="space-y-1">
                                  {test.resultType === 'NUMERIC' ? (
                                    <input
                                      id={`test-input-field-${index}-${test.id}`}
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      value={resultState.numericValue}
                                      onChange={(e) =>
                                        handleTestResultChange(index, test.testId, 'numericValue', e.target.value)
                                      }
                                      placeholder="Enter numeric value"
                                      className={`w-full px-2.5 py-1.5 text-xs font-mono font-bold rounded-lg border bg-white text-[#111311] focus:ring-2 focus:ring-[#1E40AF] outline-none ${
                                        testError ? 'border-rose-500' : 'border-[#C4B9A3]'
                                      }`}
                                    />
                                  ) : Array.isArray(test.resultOptions) && test.resultOptions.length > 0 ? (
                                    <QualitativeResultRadioGroup
                                      name={`dispatch-contractor-${portion.clientId}-${test.id}`}
                                      value={resultState.textValue || null}
                                      options={test.resultOptions}
                                      onChange={(val) =>
                                        handleTestResultChange(index, test.testId, 'textValue', val)
                                      }
                                      error={testError}
                                      ariaLabel={`${test.testName} result for Portion ${portion.portionNumber}`}
                                    />
                                  ) : (
                                    <input
                                      id={`test-input-field-${index}-${test.id}`}
                                      type="text"
                                      value={resultState.textValue}
                                      onChange={(e) =>
                                        handleTestResultChange(index, test.testId, 'textValue', e.target.value)
                                      }
                                      placeholder="Enter result"
                                      className={`w-full px-2.5 py-1.5 text-xs font-mono font-bold rounded-lg border bg-white text-[#111311] focus:ring-2 focus:ring-[#1E40AF] outline-none ${
                                        testError ? 'border-rose-500' : 'border-[#C4B9A3]'
                                      }`}
                                    />
                                  )}
                                </div>
                              ) : (
                                <div className="space-y-1">
                                  <input
                                    id={`test-reason-field-${index}-${test.id}`}
                                    type="text"
                                    value={resultState.notPerformedReason}
                                    onChange={(e) =>
                                      handleTestResultChange(index, test.testId, 'notPerformedReason', e.target.value)
                                    }
                                    placeholder="Reason (e.g. Contract Vehicle)"
                                    className={`w-full px-2.5 py-1.5 text-xs font-mono font-bold rounded-lg border bg-rose-50/40 text-rose-900 border-rose-300 focus:ring-2 focus:ring-rose-500 outline-none ${
                                      testError ? 'border-rose-500' : ''
                                    }`}
                                  />
                                </div>
                              )}

                              {testError && (
                                <p className="text-[11px] font-bold text-rose-600 mt-0.5" id={`test-error-${index}-${test.id}`}>
                                  {testError}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    /* ZMCC Full Manual Lab Tests Input Grid (UNCHANGED) */
                    <div className="space-y-2 pt-1">
                      <div className="flex items-center justify-between border-b pb-1">
                        <label className="block text-xs font-extrabold uppercase text-[#111311]">
                          Lab Tests ({manualLabTests.length} Manual Observations)
                        </label>
                        <span className="text-[10px] font-bold text-slate-500">
                          ZMCC Strict Mode Testing
                        </span>
                      </div>

                      {isLoadingTests ? (
                        <p className="text-xs text-slate-500">Loading lab tests...</p>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          {manualLabTests.map((test) => {
                            const resultState = portion.results[test.testId] || {
                              numericValue: '',
                              textValue: '',
                              performanceStatus: 'PERFORMED',
                              notPerformedReason: '',
                            };
                            const testError = portionErrors[index]?.tests?.[test.testId];

                            return (
                              <div
                                key={`test-input-${portion.clientId}-${test.id}`}
                                className={`p-2.5 rounded-xl bg-[#F4EFE3] border space-y-1.5 ${
                                  testError ? 'border-rose-500 bg-rose-50/20' : 'border-[#C4B9A3]'
                                }`}
                              >
                                <div className="flex items-center justify-between text-xs font-bold">
                                  <span>
                                    {test.testName} {test.isRequired && <span className="text-rose-600">*</span>}
                                  </span>
                                  {test.unit && (
                                    <span className="text-[10px] font-mono text-slate-500">({test.unit})</span>
                                  )}
                                </div>

                                {test.resultType === 'NUMERIC' ? (
                                  <div className="space-y-1">
                                    <div className="flex items-center justify-between text-[10px] font-bold text-slate-600">
                                      <div className="flex items-center space-x-1">
                                        <button
                                          type="button"
                                          onClick={() => handlePerformanceStatusChange(index, test.testId, 'PERFORMED')}
                                          className={`px-2 py-0.5 rounded font-black transition ${
                                            resultState.performanceStatus === 'PERFORMED'
                                              ? 'bg-blue-700 text-white'
                                              : 'bg-slate-200 text-slate-700'
                                          }`}
                                        >
                                          PERFORMED
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handlePerformanceStatusChange(index, test.testId, 'NOT_PERFORMED')}
                                          className={`px-2 py-0.5 rounded font-black transition ${
                                            resultState.performanceStatus === 'NOT_PERFORMED'
                                              ? 'bg-rose-700 text-white'
                                              : 'bg-slate-200 text-slate-700'
                                          }`}
                                        >
                                          NOT PERFORMED
                                        </button>
                                      </div>
                                    </div>

                                    {resultState.performanceStatus === 'PERFORMED' ? (
                                      <input
                                        id={`test-input-field-${index}-${test.id}`}
                                        type="number"
                                        step="0.01"
                                        value={resultState.numericValue}
                                        onChange={(e) =>
                                          handleTestResultChange(index, test.testId, 'numericValue', e.target.value)
                                        }
                                        placeholder="Enter value"
                                        className={`w-full px-2.5 py-1.5 text-xs font-mono font-bold rounded-lg border bg-white text-[#111311] ${
                                          testError ? 'border-rose-500 focus:ring-2 focus:ring-rose-500' : 'border-[#C4B9A3]'
                                        }`}
                                      />
                                    ) : (
                                      <input
                                        id={`test-input-field-${index}-${test.id}`}
                                        type="text"
                                        value={resultState.notPerformedReason}
                                        onChange={(e) =>
                                          handleTestResultChange(index, test.testId, 'notPerformedReason', e.target.value)
                                        }
                                        placeholder="Enter reason for not performing"
                                        className={`w-full px-2.5 py-1.5 text-xs font-mono font-bold rounded-lg border bg-rose-50 text-rose-900 border-rose-300 ${
                                          testError ? 'border-rose-500 focus:ring-2 focus:ring-rose-500' : ''
                                        }`}
                                      />
                                    )}
                                  </div>
                                ) : Array.isArray(test.resultOptions) && test.resultOptions.length > 0 ? (
                                  <div className="space-y-1">
                                    <div className="flex items-center justify-between text-[10px] font-bold text-slate-600">
                                      <div className="flex items-center space-x-1">
                                        <button
                                          type="button"
                                          onClick={() => handlePerformanceStatusChange(index, test.testId, 'PERFORMED')}
                                          className={`px-2 py-0.5 rounded font-black transition ${
                                            resultState.performanceStatus === 'PERFORMED'
                                              ? 'bg-blue-700 text-white'
                                              : 'bg-slate-200 text-slate-700'
                                          }`}
                                        >
                                          PERFORMED
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handlePerformanceStatusChange(index, test.testId, 'NOT_PERFORMED')}
                                          className={`px-2 py-0.5 rounded font-black transition ${
                                            resultState.performanceStatus === 'NOT_PERFORMED'
                                              ? 'bg-rose-700 text-white'
                                              : 'bg-slate-200 text-slate-700'
                                          }`}
                                        >
                                          NOT PERFORMED
                                        </button>
                                      </div>
                                    </div>

                                    {resultState.performanceStatus === 'PERFORMED' ? (
                                      <QualitativeResultRadioGroup
                                        name={`dispatch-zmcc-${portion.clientId}-${test.id}`}
                                        value={resultState.textValue || null}
                                        options={test.resultOptions}
                                        onChange={(val) =>
                                          handleTestResultChange(index, test.testId, 'textValue', val)
                                        }
                                        error={testError}
                                        ariaLabel={`${test.testName} result for Portion ${portion.portionNumber}`}
                                      />
                                    ) : (
                                      <input
                                        id={`test-input-field-${index}-${test.id}`}
                                        type="text"
                                        value={resultState.notPerformedReason}
                                        onChange={(e) =>
                                          handleTestResultChange(index, test.testId, 'notPerformedReason', e.target.value)
                                        }
                                        placeholder="Enter reason for not performing"
                                        className={`w-full px-2.5 py-1.5 text-xs font-mono font-bold rounded-lg border bg-rose-50 text-rose-900 border-rose-300 ${
                                          testError ? 'border-rose-500 focus:ring-2 focus:ring-rose-500' : ''
                                        }`}
                                      />
                                    )}
                                  </div>
                                ) : (
                                  <input
                                    id={`test-input-field-${index}-${test.id}`}
                                    type="text"
                                    value={resultState.textValue}
                                    onChange={(e) =>
                                      handleTestResultChange(index, test.testId, 'textValue', e.target.value)
                                    }
                                    placeholder="Enter result"
                                    className={`w-full px-2.5 py-1.5 text-xs font-mono font-bold rounded-lg border bg-white text-[#111311] ${
                                      testError ? 'border-rose-500 focus:ring-2 focus:ring-rose-500' : 'border-[#C4B9A3]'
                                    }`}
                                  />
                                )}

                                {testError && (
                                  <p className="text-[11px] font-bold text-rose-600 mt-1" id={`test-error-${index}-${test.id}`}>
                                    {testError}
                                  </p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Dynamic Calculation Strip */}
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                    <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                      <span className="flex items-center space-x-1">
                        <Calculator className="w-3.5 h-3.5 text-[#1E40AF]" />
                        <span>Live Calculation Summary (Canonical Formulae)</span>
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono font-bold">
                      <div className="p-2 rounded-lg bg-white border border-slate-200">
                        <span className="text-[9px] font-sans text-slate-500 block uppercase">Declared Quantity</span>
                        <span className="text-slate-900">
                          {calcValues.declaredVal !== null ? `${calcValues.declaredVal.toLocaleString()} ${calcValues.unit}` : '—'}
                        </span>
                      </div>

                      <div className="p-2 rounded-lg bg-white border border-slate-200">
                        <span className="text-[9px] font-sans text-slate-500 block uppercase">Density</span>
                        <span className="text-slate-900">
                          {calcValues.density !== null ? `${calcValues.density.toFixed(4)} g/mL` : '—'}
                        </span>
                      </div>

                      <div className="p-2 rounded-lg bg-white border border-slate-200">
                        <span className="text-[9px] font-sans text-slate-500 block uppercase">
                          Physical Liters
                        </span>
                        <span className="text-emerald-900">
                          {calcValues.physicalLiters !== null ? `${Math.round(calcValues.physicalLiters).toLocaleString()} L` : '—'}
                        </span>
                      </div>

                      <div className="p-2 rounded-lg bg-white border border-slate-200">
                        <span className="text-[9px] font-sans text-slate-500 block uppercase">SNF %</span>
                        <span className="text-blue-900">
                          {calcValues.snf !== null ? `${calcValues.snf.toFixed(3)} %` : '—'}
                        </span>
                      </div>

                      <div className="p-2 rounded-lg bg-white border border-slate-200">
                        <span className="text-[9px] font-sans text-slate-500 block uppercase">Total Solids (TS %)</span>
                        <span className="text-blue-900">
                          {calcValues.ts !== null ? `${calcValues.ts.toFixed(3)} %` : '—'}
                        </span>
                      </div>

                      <div className="p-2 rounded-lg bg-white border border-slate-200">
                        <span className="text-[9px] font-sans text-slate-500 block uppercase">SNF : Fat Ratio</span>
                        <span className="text-blue-900">
                          {calcValues.ratio !== null ? calcValues.ratio.toFixed(3) : '—'}
                        </span>
                      </div>

                      <div className="p-2 rounded-lg bg-white border border-slate-200 col-span-2">
                        <span className="text-[9px] font-sans text-slate-500 block uppercase">13 TS</span>
                        <span className="text-emerald-900">
                          {calcValues.at13TsLiters !== null ? `${Math.round(calcValues.at13TsLiters).toLocaleString()} L` : '—'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Save Portion Action Controls */}
                  <div className="flex items-center justify-end space-x-2 pt-2 border-t">
                    {portions.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemovePortion(index)}
                        className="px-3 py-1.5 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-xs font-bold hover:bg-rose-100"
                      >
                        Remove
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleSavePortion(index)}
                      className="px-4 py-2 rounded-xl bg-emerald-700 text-white text-xs font-bold shadow-sm hover:bg-emerald-800 transition"
                    >
                      Save Portion
                    </button>
                  </div>
                </div>
              );
            }

            return null;
          })}
        </div>

        {/* Add Portion Button when all saved */}
        {editingPortionIndex === null && (
          <button
            type="button"
            onClick={handleAddPortionClick}
            className="w-full py-2.5 rounded-xl border-2 border-dashed border-[#1E40AF] text-[#1E40AF] font-bold text-xs bg-blue-50/50 hover:bg-blue-100/50 transition flex items-center justify-center space-x-1.5"
          >
            <PlusCircle className="w-4 h-4" />
            <span>+ Add Portion</span>
          </button>
        )}
      </div>

      {/* Final Dispatch Summary & Submission Footer */}
      <div className="p-4 rounded-xl bg-[#F4EFE3] border border-[#C4B9A3] space-y-3 pt-3">
        <div className="flex items-center justify-between text-xs font-extrabold text-[#111311]">
          <span>Portions: <span className="font-mono text-[#1E40AF]">{portions.length}</span> ({savedCount} Saved)</span>
          <span>
            Vehicle Quantity:{' '}
            <span className="font-mono text-[#1E40AF]">
              {vehicleQuantity.value ? `${vehicleQuantity.value} ${vehicleQuantity.unit}` : '—'}
            </span>
          </span>
        </div>

        <button
          type="submit"
          disabled={isSubmitting || savedCount === 0 || editingPortionIndex !== null || !vehicleNumber.trim() || !vehicleQuantity.value || Number(vehicleQuantity.value) <= 0}
          className="w-full py-3 rounded-xl bg-[#1E40AF] text-white font-extrabold text-sm shadow-md hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {isSubmitting ? 'Submitting Dispatch...' : `Submit Dispatch (${vehicleQuantity.value ? `${vehicleQuantity.value} ${vehicleQuantity.unit}` : '—'})`}
        </button>
      </div>
    </form>
  );
};
