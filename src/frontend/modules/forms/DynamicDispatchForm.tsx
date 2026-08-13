'use client';

import React, { useState, useEffect } from 'react';
import { toDatetimeLocalInput, datetimeLocalToIso } from '@/lib/datetime-utils';
import { PlusCircle, Trash2, Check, Edit2, Clock, Calculator } from 'lucide-react';
import { useToast } from '@/frontend/context/ToastContext';
import { User } from '@core/types';
import {
  calculateSNF,
  calculateTS,
  calculateRatio,
  calculateDensity,
  calculatePhysicalLiters,
  calculateAt13TSLiters,
} from '@/backend/utils/milkFormulas';

interface LabTestDef {
  id: string;
  testCode: string;
  testName: string;
  resultType: 'NUMERIC' | 'TEXT' | 'QUALITATIVE' | 'BOOLEAN' | 'OK_NOT_OK' | 'POSITIVE_NEGATIVE' | 'CALCULATED' | string;
  unit: string | null;
  isRequired: boolean;
  displayOrder: number;
}

interface PortionFormState {
  clientId: string;
  portionNumber: number;
  declaredQuantityKg: number | '';
  results: Record<string, { numericValue: string; textValue: string }>;
  isSaved: boolean;
}

interface DynamicDispatchFormProps {
  currentUser: User | null;
  onSuccess?: () => void;
}

export const DynamicDispatchForm: React.FC<DynamicDispatchFormProps> = ({ currentUser, onSuccess }) => {
  const toast = useToast();
  const [labTests, setLabTests] = useState<LabTestDef[]>([]);
  const [isLoadingTests, setIsLoadingTests] = useState(true);

  // Vehicle Header Fields
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [vehicleNumberError, setVehicleNumberError] = useState<string | null>(null);
  const [dispatchOpDatetime, setDispatchOpDatetime] = useState<string>(toDatetimeLocalInput(new Date()));

  // Portions Draft State
  const [portions, setPortions] = useState<PortionFormState[]>([]);
  // Currently expanded portion editor index (null if all collapsed)
  const [editingPortionIndex, setEditingPortionIndex] = useState<number | null>(0);

  // Per-portion inline errors state: index -> { declaredQuantityKg?: string, tests: Record<testId, errorMsg> }
  const [portionErrors, setPortionErrors] = useState<
    Record<number, { declaredQuantityKg?: string; tests?: Record<string, string> }>
  >({});

  const [isSubmitting, setIsSubmitting] = useState(false);
  const boundContractor = currentUser?.zone || 'ZMCC / Contractor';

  useEffect(() => {
    async function loadActiveDispatchTests() {
      try {
        const res = await fetch('/api/lab-tests?scope=DISPATCH');
        const data = await res.json();
        if (data.tests) {
          setLabTests(data.tests);
          const initialResults = buildInitialPortionResults(data.tests);

          setPortions([
            {
              clientId: 'portion-1',
              portionNumber: 1,
              declaredQuantityKg: '',
              results: initialResults,
              isSaved: false,
            },
          ]);
        }
      } catch (err: any) {
        toast.showError('Failed to load lab test definitions', 'Load Error');
      } finally {
        setIsLoadingTests(false);
      }
    }
    loadActiveDispatchTests();
  }, []);

  const buildInitialPortionResults = (tests: LabTestDef[]): Record<string, { numericValue: string; textValue: string }> => {
    const results: Record<string, { numericValue: string; textValue: string }> = {};

    tests.forEach((t) => {
      if (t.resultType === 'OK_NOT_OK') {
        results[t.id] = { numericValue: '', textValue: 'OK' };
      } else if (t.resultType === 'POSITIVE_NEGATIVE') {
        results[t.id] = { numericValue: '', textValue: 'NEGATIVE' };
      } else if (t.resultType === 'QUALITATIVE') {
        results[t.id] = { numericValue: '', textValue: 'OK' };
      } else if (t.resultType === 'BOOLEAN') {
        results[t.id] = { numericValue: '', textValue: 'NO' };
      } else {
        // Manual NUMERIC & CALCULATED tests start empty
        results[t.id] = { numericValue: '', textValue: '' };
      }
    });

    return results;
  };

  const createFreshPortion = (portionNumber: number): PortionFormState => {
    const freshResults = buildInitialPortionResults(labTests);

    const clientId =
      typeof window !== 'undefined' && window.crypto?.randomUUID
        ? window.crypto.randomUUID()
        : `portion-${Date.now()}-${portionNumber}`;

    return {
      clientId,
      portionNumber,
      declaredQuantityKg: '',
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

  const handleAddPortionClick = () => {
    if (editingPortionIndex !== null) {
      const currentEditing = portions[editingPortionIndex];
      if (currentEditing && (!currentEditing.declaredQuantityKg || Number(currentEditing.declaredQuantityKg) <= 0)) {
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

  const handleSavePortion = (index: number): boolean => {
    const target = portions[index];
    if (!target) return false;

    const errors: { declaredQuantityKg?: string; tests: Record<string, string> } = { tests: {} };
    let firstInvalidId: string | null = null;

    // 1. Declared Quantity Validation
    const qty = Number(target.declaredQuantityKg);
    if (!target.declaredQuantityKg || isNaN(qty) || qty <= 0) {
      errors.declaredQuantityKg = 'Enter a valid quantity greater than 0 kg.';
      if (!firstInvalidId) {
        firstInvalidId = `declared-qty-input-${index}`;
      }
    }

    // 2. Required Manual Lab Tests Validation (Excludes CALCULATED tests)
    const requiredManualTests = labTests.filter((t) => t.isRequired && t.resultType !== 'CALCULATED');
    for (const reqTest of requiredManualTests) {
      const res = target.results[reqTest.id];
      if (!res) {
        errors.tests[reqTest.id] = `Result for ${reqTest.testName} is required.`;
        if (!firstInvalidId) {
          firstInvalidId = `test-input-field-${index}-${reqTest.id}`;
        }
      } else if (reqTest.resultType === 'NUMERIC') {
        if (res.numericValue === '' || isNaN(Number(res.numericValue)) || Number(res.numericValue) < 0) {
          errors.tests[reqTest.id] = `Enter a valid numeric value for ${reqTest.testName}.`;
          if (!firstInvalidId) {
            firstInvalidId = `test-input-field-${index}-${reqTest.id}`;
          }
        }
      } else {
        if (!res.textValue || res.textValue.trim() === '') {
          errors.tests[reqTest.id] = `Result for ${reqTest.testName} is required.`;
          if (!firstInvalidId) {
            firstInvalidId = `test-input-field-${index}-${reqTest.id}`;
          }
        }
      }
    }

    const hasErrors = !!errors.declaredQuantityKg || Object.keys(errors.tests).length > 0;

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

    // Clear portion errors for deleted index and adjust shifted indices
    setPortionErrors((prev) => {
      const nextErrors: Record<number, { declaredQuantityKg?: string; tests?: Record<string, string> }> = {};
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

  const handlePortionQtyChange = (index: number, val: string) => {
    const updated = [...portions];
    updated[index].declaredQuantityKg = val ? Number(val) : '';
    setPortions(updated);

    // Clear inline quantity error as soon as a valid value > 0 is provided
    if (val && Number(val) > 0) {
      setPortionErrors((prev) => {
        if (!prev[index]?.declaredQuantityKg) return prev;
        const copy = { ...prev[index] };
        delete copy.declaredQuantityKg;
        return { ...prev, [index]: copy };
      });
    }
  };

  const handleTestResultChange = (
    portionIndex: number,
    testId: string,
    field: 'numericValue' | 'textValue',
    value: string
  ) => {
    const updated = [...portions];
    const currentRes = updated[portionIndex].results[testId] || { numericValue: '', textValue: '' };
    const newRes = { ...currentRes, [field]: value };
    updated[portionIndex].results[testId] = newRes;
    setPortions(updated);

    // Clear lab test error as soon as a valid value is provided
    setPortionErrors((prev) => {
      if (!prev[portionIndex]?.tests?.[testId]) return prev;
      const testDef = labTests.find((t) => t.id === testId);
      let isNowValid = false;

      if (field === 'numericValue') {
        isNowValid = value !== '' && !isNaN(Number(value)) && Number(value) >= 0;
      } else {
        isNowValid = !!value && value.trim() !== '';
      }

      if (isNowValid) {
        const testsCopy = { ...prev[portionIndex].tests };
        delete testsCopy[testId];
        return {
          ...prev,
          [portionIndex]: {
            ...prev[portionIndex],
            tests: testsCopy,
          },
        };
      }
      return prev;
    });
  };

  // Completeness counter: Counts required MANUAL / OBSERVED tests only (excludes CALCULATED tests)
  const getPortionProgress = (portion: PortionFormState) => {
    const manualRequiredTests = labTests.filter((t) => t.isRequired && t.resultType !== 'CALCULATED');
    const completedCount = manualRequiredTests.filter((t) => {
      const res = portion.results[t.id];
      if (!res) return false;
      if (t.resultType === 'NUMERIC') return res.numericValue !== '' && !isNaN(Number(res.numericValue));
      return res.textValue !== '' && res.textValue !== null && res.textValue !== undefined;
    }).length;

    return { completed: completedCount, total: manualRequiredTests.length };
  };

  // Helper to compute live calculated milk metrics for a portion
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

    const rawLr = lrTest ? portion.results[lrTest.id]?.numericValue : '';
    const rawFat = fatTest ? portion.results[fatTest.id]?.numericValue : '';
    const declaredKg = Number(portion.declaredQuantityKg);

    const lrNum = rawLr !== '' && rawLr !== undefined && !isNaN(Number(rawLr)) ? Number(rawLr) : null;
    const fatNum = rawFat !== '' && rawFat !== undefined && !isNaN(Number(rawFat)) ? Number(rawFat) : null;
    const kgNum = !isNaN(declaredKg) && declaredKg > 0 ? declaredKg : null;

    let snfVal: number | null = null;
    let tsVal: number | null = null;
    let ratioVal: number | null = null;
    let densityVal: number | null = null;
    let physLitersVal: number | null = null;
    let at13TsLitersVal: number | null = null;

    if (lrNum !== null && fatNum !== null) {
      snfVal = calculateSNF(lrNum, fatNum);
      tsVal = calculateTS(fatNum, snfVal);
      ratioVal = calculateRatio(snfVal, fatNum);
      densityVal = calculateDensity(lrNum);

      if (kgNum !== null) {
        physLitersVal = calculatePhysicalLiters(kgNum, lrNum);
        at13TsLitersVal = calculateAt13TSLiters(physLitersVal, tsVal);
      }
    }

    return {
      declaredKg: kgNum,
      snf: snfVal,
      ts: tsVal,
      ratio: ratioVal,
      density: densityVal,
      physicalLiters: physLitersVal,
      at13TsLiters: at13TsLitersVal,
    };
  };

  const totalDeclaredKg = portions.reduce(
    (sum, p) => sum + (p.isSaved && p.declaredQuantityKg ? Number(p.declaredQuantityKg) : 0),
    0
  );

  const savedCount = portions.filter((p) => p.isSaved).length;

  // Filter out CALCULATED tests from the editable LAB TESTS input grid
  const manualLabTests = labTests.filter((t) => t.resultType !== 'CALCULATED');

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

    const payloadPortions = portions.map((p) => ({
      portionNumber: p.portionNumber,
      declaredQuantityKg: Number(p.declaredQuantityKg) || 0,
      dispatchTimestamp: isoDispatchTimestamp,
      results: labTests.map((t) => {
        const res = p.results[t.id] || { numericValue: '', textValue: '' };
        return {
          testId: t.id,
          numericValue: t.resultType === 'NUMERIC' ? (res.numericValue !== '' ? Number(res.numericValue) : null) : null,
          textValue: t.resultType !== 'NUMERIC' ? (res.textValue ? res.textValue : null) : null,
        };
      }),
    }));

    try {
      const res = await fetch('/api/dispatches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicleNumber: vehicleNumber.trim().toUpperCase(),
          operationalDate: (isoDispatchTimestamp || new Date().toISOString()).split('T')[0],
          zonalContractorName: boundContractor,
          portions: payloadPortions,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit dispatch');

      const successText = `Vehicle dispatch created successfully for ${vehicleNumber.toUpperCase()}.`;
      toast.showSuccess(successText, 'Dispatch Recorded');

      // Reset Form to fresh initial state
      setVehicleNumber('');
      setVehicleNumberError(null);
      setPortionErrors({});
      const initialResults = buildInitialPortionResults(labTests);
      setPortions([
        {
          clientId: 'portion-1',
          portionNumber: 1,
          declaredQuantityKg: '',
          results: initialResults,
          isSaved: false,
        },
      ]);
      setEditingPortionIndex(0);

      if (onSuccess) onSuccess();
    } catch (err: any) {
      toast.showError(err.message || 'Failed to submit dispatch', 'Dispatch Error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmitDispatch} className="p-6 rounded-2xl bg-[#EFE9D9] border border-[#C4B9A3] shadow-sm space-y-5 text-[#111311]">
      <div className="pb-2 border-b border-[#C4B9A3]">
        <h2 className="text-lg font-extrabold text-[#111311]">New Dispatch</h2>
      </div>

      {/* Zone Display & Vehicle Fields */}
      <div className="p-3.5 rounded-xl bg-[#F4EFE3] border border-[#C4B9A3] space-y-3">
        <div className="text-xs font-extrabold text-[#334155] border-b border-[#C4B9A3] pb-2">
          Zone: <span className="text-[#111311] font-mono">{boundContractor}</span>
        </div>

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
              <span>Dispatch Operational Date & Time *</span>
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
                            {Number(portion.declaredQuantityKg).toLocaleString()} KG
                          </span>
                        </div>
                        <p className="text-[11px] font-bold text-slate-600 mt-0.5">
                          {progress.completed} of {progress.total} required tests completed
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
                      <span className="text-[9px] font-sans text-slate-500 block">@13 TS Liters</span>
                      <span>{calcValues.at13TsLiters !== null ? `${Math.round(calcValues.at13TsLiters).toLocaleString()} L` : '—'}</span>
                    </div>
                  </div>
                </div>
              );
            }

            // Expanded Portion Editor View
            if (isEditing) {
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
                      {progress.completed} of {progress.total} required tests completed
                    </span>
                  </div>

                  {/* Declared Quantity Input */}
                  <div>
                    <label className="block text-xs font-bold text-[#111311] mb-1">
                      Declared Quantity (KG) *
                    </label>
                    <input
                      id={`declared-qty-input-${index}`}
                      type="number"
                      step="0.01"
                      value={portion.declaredQuantityKg}
                      onChange={(e) => handlePortionQtyChange(index, e.target.value)}
                      placeholder="e.g. 8500"
                      className={`w-full px-3.5 py-2 text-sm font-mono font-bold rounded-xl border bg-[#F4EFE3] text-[#111311] focus:ring-2 focus:ring-[#1E40AF] outline-none ${
                        portionErrors[index]?.declaredQuantityKg
                          ? 'border-rose-500 bg-rose-50/20 ring-1 ring-rose-500'
                          : 'border-[#C4B9A3]'
                      }`}
                      required
                    />
                    {portionErrors[index]?.declaredQuantityKg && (
                      <p className="text-xs font-bold text-rose-600 mt-1" id={`declared-qty-error-${index}`}>
                        {portionErrors[index].declaredQuantityKg}
                      </p>
                    )}
                  </div>

                  {/* Manual Lab Tests Input Grid (Calculated tests excluded) */}
                  <div className="space-y-2 pt-1">
                    <div className="flex items-center justify-between border-b pb-1">
                      <label className="block text-xs font-extrabold uppercase text-[#111311]">
                        Lab Tests ({manualLabTests.length} Manual Observations)
                      </label>
                      <span className="text-[10px] font-bold text-slate-500">Qualitative defaults auto-selected</span>
                    </div>

                    {isLoadingTests ? (
                      <p className="text-xs text-slate-500">Loading lab tests...</p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {manualLabTests.map((test) => {
                          const resultState = portion.results[test.id] || { numericValue: '', textValue: '' };
                          const testError = portionErrors[index]?.tests?.[test.id];

                          return (
                            <div
                              key={`test-input-${portion.clientId}-${test.id}`}
                              className={`p-2.5 rounded-xl bg-[#F4EFE3] border space-y-1 ${
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
                                <input
                                  id={`test-input-field-${index}-${test.id}`}
                                  type="number"
                                  step="0.01"
                                  value={resultState.numericValue}
                                  onChange={(e) =>
                                    handleTestResultChange(index, test.id, 'numericValue', e.target.value)
                                  }
                                  placeholder="Enter value"
                                  className={`w-full px-2.5 py-1.5 text-xs font-mono font-bold rounded-lg border bg-white text-[#111311] ${
                                    testError ? 'border-rose-500 focus:ring-2 focus:ring-rose-500' : 'border-[#C4B9A3]'
                                  }`}
                                  required={test.isRequired}
                                />
                              ) : test.resultType === 'OK_NOT_OK' ? (
                                <select
                                  id={`test-input-field-${index}-${test.id}`}
                                  value={resultState.textValue || 'OK'}
                                  onChange={(e) =>
                                    handleTestResultChange(index, test.id, 'textValue', e.target.value)
                                  }
                                  className={`w-full px-2.5 py-1.5 text-xs font-mono font-bold rounded-lg border bg-white text-[#111311] ${
                                    testError ? 'border-rose-500 focus:ring-2 focus:ring-rose-500' : 'border-[#C4B9A3]'
                                  }`}
                                >
                                  <option value="OK">OK</option>
                                  <option value="NOT_OK">NOT_OK</option>
                                </select>
                              ) : test.resultType === 'POSITIVE_NEGATIVE' ? (
                                <select
                                  id={`test-input-field-${index}-${test.id}`}
                                  value={resultState.textValue || 'NEGATIVE'}
                                  onChange={(e) =>
                                    handleTestResultChange(index, test.id, 'textValue', e.target.value)
                                  }
                                  className={`w-full px-2.5 py-1.5 text-xs font-mono font-bold rounded-lg border bg-white text-[#111311] ${
                                    testError ? 'border-rose-500 focus:ring-2 focus:ring-rose-500' : 'border-[#C4B9A3]'
                                  }`}
                                >
                                  <option value="NEGATIVE">NEGATIVE</option>
                                  <option value="POSITIVE">POSITIVE</option>
                                </select>
                              ) : (
                                <input
                                  id={`test-input-field-${index}-${test.id}`}
                                  type="text"
                                  value={resultState.textValue}
                                  onChange={(e) =>
                                    handleTestResultChange(index, test.id, 'textValue', e.target.value)
                                  }
                                  placeholder="Enter result"
                                  className={`w-full px-2.5 py-1.5 text-xs font-mono font-bold rounded-lg border bg-white text-[#111311] ${
                                    testError ? 'border-rose-500 focus:ring-2 focus:ring-rose-500' : 'border-[#C4B9A3]'
                                  }`}
                                  required={test.isRequired}
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

                  {/* Compact Calculated Milk Values Card */}
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                    <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
                      <div className="flex items-center space-x-1.5 text-slate-800">
                        <Calculator className="w-3.5 h-3.5 text-blue-700" />
                        <span className="text-xs font-black uppercase tracking-wider text-slate-700">
                          Calculated Milk Values
                        </span>
                      </div>
                      <span className="text-[10px] font-mono font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                        Auto-Derived
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono font-bold">
                      <div className="p-2 rounded-lg bg-white border border-slate-200">
                        <span className="text-[9px] font-sans text-slate-500 block uppercase">Declared Volume</span>
                        <span className="text-slate-900">
                          {calcValues.declaredKg !== null ? `${calcValues.declaredKg.toLocaleString()} KG` : '—'}
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

                      <div className="p-2 rounded-lg bg-white border border-slate-200">
                        <span className="text-[9px] font-sans text-slate-500 block uppercase">Density</span>
                        <span className="text-slate-900">
                          {calcValues.density !== null ? `${calcValues.density.toFixed(4)} g/mL` : '—'}
                        </span>
                      </div>

                      <div className="p-2 rounded-lg bg-white border border-slate-200">
                        <span className="text-[9px] font-sans text-slate-500 block uppercase">Physical Liters</span>
                        <span className="text-emerald-900">
                          {calcValues.physicalLiters !== null ? `${Math.round(calcValues.physicalLiters).toLocaleString()} L` : '—'}
                        </span>
                      </div>

                      <div className="p-2 rounded-lg bg-white border border-slate-200 col-span-2">
                        <span className="text-[9px] font-sans text-slate-500 block uppercase">@13 TS Liters (Payment Std)</span>
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
          <span>Total Volume: <span className="font-mono text-[#1E40AF]">{totalDeclaredKg.toLocaleString()} KG</span></span>
        </div>

        <button
          type="submit"
          disabled={isSubmitting || savedCount === 0 || editingPortionIndex !== null || !vehicleNumber.trim()}
          className="w-full py-3 rounded-xl bg-[#1E40AF] text-white font-extrabold text-sm shadow-md hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {isSubmitting ? 'Submitting Dispatch...' : `Submit Dispatch (${totalDeclaredKg.toLocaleString()} KG)`}
        </button>
      </div>
    </form>
  );
};
