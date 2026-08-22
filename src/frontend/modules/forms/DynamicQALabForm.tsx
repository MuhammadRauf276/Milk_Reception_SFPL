'use client';

import React, { useState, useEffect } from 'react';
import { FlaskConical, Search, CheckCircle2, ShieldAlert, Save, RefreshCw, X, AlertTriangle, Lock } from 'lucide-react';
import { User } from '@core/types';

interface LabTestDef {
  id: string;
  testCode: string;
  testName: string;
  resultType: 'NUMERIC' | 'TEXT' | 'QUALITATIVE' | 'BOOLEAN';
  unit: string | null;
  testScope: string;
  isRequired: boolean;
  displayOrder: number;
}

interface DispatchResultItem {
  testId: string;
  testCode: string;
  testName: string;
  resultType: string;
  unit: string | null;
  numericValue: number | null;
  textValue: string | null;
  isPassed: boolean | null;
}

interface PlantResultItem {
  testId: string;
  testCode: string;
  testName: string;
  resultType: string;
  unit: string | null;
  numericValue: number | null;
  textValue: string | null;
  isPassed: boolean | null;
}

interface PortionDetail {
  id: string;
  visit_id: string;
  portion_number: number;
  current_status: string;
  dispatch_quantity_value?: number | null;
  dispatch_quantity_unit?: string;
  dispatch_quantity_basis?: string;
  dispatch_measurement_method?: string;
  plant_decision: string;
  plant_rejection_reason: string | null;
  plant_decided_at: string | null;
  dispatch_results: DispatchResultItem[];
  plant_results: PlantResultItem[];
}

interface VisitDetail {
  id: string;
  visit_number: string;
  vehicle_number: string;
  token_number: string | null;
  operational_date: string | null;
  current_status: string;
  visit_decision_summary: string;
  vehicle_dispatch_quantity_value?: number | null;
  vehicle_dispatch_quantity_unit?: string | null;
  portions: PortionDetail[];
  active_plant_tests: LabTestDef[];
}

interface DynamicQALabFormProps {
  currentUser?: User | null;
  initialVisitId?: string | null;
  onClose?: () => void;
}

export const DynamicQALabForm: React.FC<DynamicQALabFormProps> = ({ currentUser, initialVisitId, onClose }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const [visit, setVisit] = useState<VisitDetail | null>(null);
  const [activePortionIndex, setActivePortionIndex] = useState<number>(0);
  const [isLoadingVisit, setIsLoadingVisit] = useState(false);

  // Form State for active portion: testId -> { numericValue: string, textValue: string }
  const [plantInputs, setPlantInputs] = useState<Record<string, { numericValue: string; textValue: string }>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    handleSearch('');
  }, []);

  useEffect(() => {
    if (initialVisitId) {
      loadVisitDetail(initialVisitId);
    }
  }, [initialVisitId]);

  const handleSearch = async (query: string) => {
    setIsSearching(true);
    try {
      const res = await fetch(`/api/qa/vehicle-visits/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (data.visits) setSearchResults(data.visits);
    } catch (err: any) {
      console.error('Error searching QA visits', err);
    } finally {
      setIsSearching(false);
    }
  };

  const loadVisitDetail = async (visitId: string) => {
    setIsLoadingVisit(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(`/api/qa/vehicle-visits/${visitId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load vehicle visit details');
      
      const v = data.visit as VisitDetail;
      setVisit(v);
      setActivePortionIndex(0);
      initializePlantInputs(v, 0);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setIsLoadingVisit(false);
    }
  };

  const initializePlantInputs = (v: VisitDetail, portionIdx: number) => {
    const p = v.portions[portionIdx];
    if (!p) return;

    const inputMap: Record<string, { numericValue: string; textValue: string }> = {};

    v.active_plant_tests.forEach((t) => {
      // Check existing plant lab result
      const existingPlantRes = p.plant_results.find((pr) => pr.testId === t.id);
      // Check corresponding ZMCC dispatch result for default prefill
      const dispatchRes = p.dispatch_results.find((dr) => dr.testCode === t.testCode);

      if (existingPlantRes) {
        inputMap[t.id] = {
          numericValue: existingPlantRes.numericValue !== null ? String(existingPlantRes.numericValue) : '',
          textValue: existingPlantRes.textValue || '',
        };
      } else if (dispatchRes) {
        inputMap[t.id] = {
          numericValue: dispatchRes.numericValue !== null ? String(dispatchRes.numericValue) : '',
          textValue: dispatchRes.textValue || '',
        };
      } else {
        const lowerName = t.testName.toLowerCase();
        if (lowerName.includes('fat')) inputMap[t.id] = { numericValue: '3.8', textValue: '' };
        else if (lowerName.includes('lactometer') || lowerName.includes('lr')) inputMap[t.id] = { numericValue: '28.5', textValue: '' };
        else if (lowerName.includes('temperature')) inputMap[t.id] = { numericValue: '4.0', textValue: '' };
        else if (lowerName.includes('mbrt')) inputMap[t.id] = { numericValue: '210', textValue: '' };
        else if (t.resultType === 'QUALITATIVE') inputMap[t.id] = { numericValue: '', textValue: 'OK' };
        else if (t.resultType === 'BOOLEAN') inputMap[t.id] = { numericValue: '', textValue: 'NO' };
        else inputMap[t.id] = { numericValue: '', textValue: '' };
      }
    });

    setPlantInputs(inputMap);
  };

  const handleSelectPortionTab = (idx: number) => {
    setActivePortionIndex(idx);
    if (visit) initializePlantInputs(visit, idx);
  };

  const handleInputChange = (testId: string, field: 'numericValue' | 'textValue', value: string) => {
    setPlantInputs((prev) => ({
      ...prev,
      [testId]: {
        ...prev[testId],
        [field]: value,
      },
    }));
  };

  const currentPortion = visit?.portions[activePortionIndex];
  const isPortionFinalized = currentPortion?.plant_decision === 'ACCEPTED' || currentPortion?.plant_decision === 'REJECTED';

  const getRequiredProgress = () => {
    if (!visit) return { completed: 0, total: 0 };
    const reqTests = visit.active_plant_tests.filter((t) => t.isRequired);
    const completedCount = reqTests.filter((t) => {
      const inp = plantInputs[t.id];
      if (!inp) return false;
      if (t.resultType === 'NUMERIC') return inp.numericValue !== '' && !isNaN(Number(inp.numericValue));
      return inp.textValue !== '' && inp.textValue !== null;
    }).length;

    return { completed: completedCount, total: reqTests.length };
  };

  const handleSaveDraft = async () => {
    if (!visit || !currentPortion) return;
    setIsSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    const payloadResults = visit.active_plant_tests.map((t) => {
      const inp = plantInputs[t.id] || { numericValue: '', textValue: '' };
      return {
        testId: t.id,
        numericValue: t.resultType === 'NUMERIC' ? (inp.numericValue !== '' ? Number(inp.numericValue) : null) : null,
        textValue: t.resultType !== 'NUMERIC' ? (inp.textValue ? inp.textValue : null) : null,
      };
    }).filter((r) => r.numericValue !== null || r.textValue !== null);

    try {
      const res = await fetch(`/api/qa/vehicle-visits/${visit.id}/portions/${currentPortion.id}/draft`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ results: payloadResults }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save QA draft');

      setSuccessMsg(`Draft saved for Portion #${currentPortion.portion_number}.`);
      loadVisitDetail(visit.id);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCompleteLabTest = async () => {
    if (!visit || !currentPortion) return;
    setIsSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    const payloadResults = visit.active_plant_tests.map((t) => {
      const inp = plantInputs[t.id] || { numericValue: '', textValue: '' };
      return {
        testId: t.id,
        numericValue: t.resultType === 'NUMERIC' ? (inp.numericValue !== '' ? Number(inp.numericValue) : null) : null,
        textValue: t.resultType !== 'NUMERIC' ? (inp.textValue ? inp.textValue : null) : null,
      };
    });

    try {
      const res = await fetch(`/api/qa/vehicle-visits/${visit.id}/portions/${currentPortion.id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ results: payloadResults }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to complete QA test');

      setSuccessMsg(`✅ ${data.message}`);
      loadVisitDetail(visit.id);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const progress = getRequiredProgress();

  return (
    <div className="space-y-6 text-[#111311]">
      {/* Top Banner Header */}
      <div className="p-5 rounded-2xl bg-[#EFE9D9] border border-[#C4B9A3] shadow-sm flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="p-3 bg-emerald-700 text-white rounded-xl shadow-sm">
            <FlaskConical className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-xl font-extrabold tracking-tight text-[#111311]">QA Plant Laboratory Workstation</h2>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-emerald-800 text-white">
                CHEMIST LABORATORY TERMINAL
              </span>
            </div>
            <p className="text-xs text-[#334155] font-semibold mt-0.5">
              Portion-level laboratory analysis, ZMCC vs Plant comparison & decision engine.
            </p>
          </div>
        </div>

        {onClose && (
          <button onClick={onClose} className="p-2 rounded-xl bg-[#F4EFE3] hover:bg-rose-100 text-slate-600 hover:text-rose-700 border border-[#C4B9A3]">
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Vehicle Search Box */}
      <div className="p-4 rounded-2xl bg-[#EFE9D9] border border-[#C4B9A3] space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-black uppercase tracking-wider text-[#111311]">
            Search In-Plant Vehicle Visit
          </span>
          <span className="text-[11px] font-semibold text-slate-500 font-mono">
            Search by Visit #, Vehicle #, or Token #
          </span>
        </div>

        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              handleSearch(e.target.value);
            }}
            placeholder="Type vehicle number (e.g. KBL-8492) or token (e.g. TK-9025)..."
            className="w-full pl-10 pr-4 py-2.5 text-xs font-mono font-bold rounded-xl border border-[#C4B9A3] bg-[#F4EFE3] text-[#111311] focus:ring-2 focus:ring-emerald-700 outline-none"
          />
        </div>

        {searchResults.length > 0 && !visit && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-48 overflow-y-auto pt-1">
            {searchResults.map((v) => (
              <div
                key={String(v.id)}
                onClick={() => loadVisitDetail(String(v.id))}
                className="p-3 rounded-xl bg-[#F4EFE3] hover:bg-emerald-50 border border-[#C4B9A3] cursor-pointer transition flex items-center justify-between"
              >
                <div>
                  <span className="font-mono font-black text-xs text-[#111311] block">{v.vehicle_number}</span>
                  <span className="text-[10px] font-mono text-slate-500">{v.visit_number} | Token #{v.token_number || 'N/A'}</span>
                </div>
                <span
                  className={`px-2 py-0.5 rounded text-[9px] font-black font-mono border ${
                    v.visit_decision_summary === 'ACCEPTED'
                      ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                      : v.visit_decision_summary === 'REJECTED'
                      ? 'bg-rose-100 text-rose-800 border-rose-300'
                      : v.visit_decision_summary === 'PARTIALLY_ACCEPTED'
                      ? 'bg-amber-100 text-amber-800 border-amber-300'
                      : 'bg-blue-100 text-blue-800 border-blue-300'
                  }`}
                >
                  {v.visit_decision_summary}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {errorMsg && (
        <div className="p-3 text-xs font-bold rounded-xl bg-rose-50 text-rose-800 border border-rose-200">
          {errorMsg}
        </div>
      )}

      {successMsg && (
        <div className="p-3 text-xs font-bold rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200">
          {successMsg}
        </div>
      )}

      {/* Selected Vehicle Testing Workspace */}
      {visit && currentPortion && (
        <div className="p-6 rounded-2xl bg-[#EFE9D9] border border-[#C4B9A3] shadow-md space-y-5">
          {/* Vehicle Metadata Header */}
          <div className="p-4 rounded-xl bg-[#F4EFE3] border border-[#C4B9A3] flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-mono font-black text-lg text-[#111311]">{visit.vehicle_number}</span>
                <span className="px-2.5 py-0.5 rounded bg-[#1E3A8A] text-white font-mono text-xs font-black">
                  Visit #{visit.visit_number}
                </span>
                {visit.token_number && (
                  <span className="px-2.5 py-0.5 rounded bg-indigo-900 text-white font-mono text-xs font-black">
                    Token #{visit.token_number}
                  </span>
                )}
              </div>
              <p className="text-xs text-[#334155] font-semibold mt-1">
                Status: <strong className="font-mono text-[#111311]">{visit.current_status}</strong> | Operational Date: {visit.operational_date}
              </p>
            </div>

            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold text-slate-600">Vehicle Summary:</span>
              <span
                className={`px-3 py-1 rounded-full text-xs font-black uppercase font-mono border ${
                  visit.visit_decision_summary === 'ACCEPTED'
                    ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                    : visit.visit_decision_summary === 'REJECTED'
                    ? 'bg-rose-100 text-rose-800 border-rose-300'
                    : visit.visit_decision_summary === 'PARTIALLY_ACCEPTED'
                    ? 'bg-amber-100 text-amber-800 border-amber-300'
                    : 'bg-blue-100 text-blue-800 border-blue-300'
                }`}
              >
                {visit.visit_decision_summary}
              </span>
            </div>
          </div>

          {/* Portion Selection Tabs */}
          <div className="flex items-center space-x-2 border-b border-[#C4B9A3] pb-2">
            {visit.portions.map((p, idx) => {
              const isActive = idx === activePortionIndex;
              return (
                <button
                  key={String(p.id)}
                  onClick={() => handleSelectPortionTab(idx)}
                  className={`px-4 py-2 rounded-xl font-bold text-xs transition flex items-center space-x-2 ${
                    isActive
                      ? 'bg-emerald-800 text-white shadow-sm'
                      : 'bg-[#F4EFE3] text-slate-700 border border-[#C4B9A3] hover:bg-amber-100/50'
                  }`}
                >
                  <span>
                    Portion #{p.portion_number} ({p.dispatch_quantity_value != null ? Number(p.dispatch_quantity_value).toLocaleString() : '—'} {p.dispatch_quantity_unit || 'KG'})
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded text-[9.5px] font-black font-mono ${
                      p.plant_decision === 'ACCEPTED'
                        ? 'bg-emerald-200 text-emerald-900'
                        : p.plant_decision === 'REJECTED'
                        ? 'bg-rose-200 text-rose-900'
                        : 'bg-amber-200 text-amber-900'
                    }`}
                  >
                    {p.plant_decision || 'PENDING'}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Portion Decision Banner if Finalized */}
          {isPortionFinalized && (
            <div
              className={`p-4 rounded-xl text-xs font-bold border flex items-center justify-between ${
                currentPortion.plant_decision === 'ACCEPTED'
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  : 'bg-rose-50 text-rose-800 border-rose-200'
              }`}
            >
              <div className="flex items-center space-x-2">
                {currentPortion.plant_decision === 'ACCEPTED' ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                ) : (
                  <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0" />
                )}
                <div>
                  <h4 className="font-extrabold uppercase text-sm">
                    Portion #{currentPortion.portion_number} Decision: {currentPortion.plant_decision}
                  </h4>
                  {currentPortion.plant_rejection_reason && (
                    <p className="text-rose-700 font-semibold mt-0.5">
                      Rejection Reason: {currentPortion.plant_rejection_reason}
                    </p>
                  )}
                </div>
              </div>
              <span className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-200 text-slate-700 font-mono text-[10px]">
                <Lock className="w-3.5 h-3.5" /> FINALIZED READ-ONLY
              </span>
            </div>
          )}

          {/* Progress Tracker */}
          <div className="flex items-center justify-between text-xs font-bold text-slate-700">
            <span>Required Plant Tests Progress:</span>
            <span className="font-mono text-emerald-800 font-black">
              {progress.completed} / {progress.total} Completed
            </span>
          </div>

          {/* Dynamic 2-Column Side-by-Side ZMCC vs Plant Comparison Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {visit.active_plant_tests.map((test) => {
              const dispatchRes = currentPortion.dispatch_results.find((dr) => dr.testCode === test.testCode);
              const inp = plantInputs[test.id] || { numericValue: '', textValue: '' };

              return (
                <div key={`${String(currentPortion.id)}-${String(test.id)}`} className="p-4 rounded-xl bg-[#F4EFE3] border border-[#C4B9A3] space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold text-xs text-[#111311]">
                      {test.testName} {test.isRequired && <span className="text-rose-600">*</span>}
                    </span>
                    {test.unit && <span className="text-[10px] font-mono font-bold text-slate-500">{test.unit}</span>}
                  </div>

                  {/* Comparison Row */}
                  <div className="grid grid-cols-2 gap-2 text-xs font-mono font-bold p-2.5 rounded-lg bg-[#EFE9D9] border border-[#C4B9A3]">
                    {/* Left: ZMCC Dispatch Value */}
                    <div>
                      <span className="text-[9.5px] font-sans text-slate-500 block uppercase">ZMCC Dispatch Result</span>
                      <span className="text-[#1E3A8A] font-extrabold">
                        {dispatchRes
                          ? test.resultType === 'NUMERIC'
                            ? `${dispatchRes.numericValue ?? '-'} ${test.unit || ''}`
                            : dispatchRes.textValue || '-'
                          : 'N/A'}
                      </span>
                    </div>

                    {/* Right: Plant Input Field */}
                    <div>
                      <span className="text-[9.5px] font-sans text-slate-500 block uppercase">Plant Lab Input</span>

                      {test.resultType === 'NUMERIC' && (
                        <input
                          type="number"
                          step="any"
                          value={inp.numericValue}
                          onChange={(e) => handleInputChange(test.id, 'numericValue', e.target.value)}
                          disabled={isPortionFinalized}
                          placeholder="Enter reading"
                          className="w-full px-2.5 py-1 text-xs font-mono font-bold rounded-lg border border-[#C4B9A3] bg-[#F4EFE3] text-[#111311] disabled:bg-slate-200 disabled:cursor-not-allowed"
                          required={test.isRequired}
                        />
                      )}

                      {test.resultType === 'QUALITATIVE' && (
                        <select
                          value={inp.textValue || 'OK'}
                          onChange={(e) => handleInputChange(test.id, 'textValue', e.target.value)}
                          disabled={isPortionFinalized}
                          className="w-full px-2 py-1 text-xs font-bold rounded-lg border border-[#C4B9A3] bg-[#F4EFE3] text-[#111311] disabled:bg-slate-200 disabled:cursor-not-allowed"
                          required={test.isRequired}
                        >
                          <option value="OK">OK</option>
                          <option value="NOT_OK">NOT_OK</option>
                          <option value="POSITIVE">POSITIVE</option>
                          <option value="NEGATIVE">NEGATIVE</option>
                          <option value="PRESENT">PRESENT</option>
                          <option value="ABSENT">ABSENT</option>
                        </select>
                      )}

                      {test.resultType === 'BOOLEAN' && (
                        <select
                          value={inp.textValue || 'NO'}
                          onChange={(e) => handleInputChange(test.id, 'textValue', e.target.value)}
                          disabled={isPortionFinalized}
                          className="w-full px-2 py-1 text-xs font-bold rounded-lg border border-[#C4B9A3] bg-[#F4EFE3] text-[#111311] disabled:bg-slate-200 disabled:cursor-not-allowed"
                          required={test.isRequired}
                        >
                          <option value="NO">No (Passed)</option>
                          <option value="YES">Yes (Failed)</option>
                        </select>
                      )}

                      {test.resultType === 'TEXT' && (
                        <input
                          type="text"
                          value={inp.textValue}
                          onChange={(e) => handleInputChange(test.id, 'textValue', e.target.value)}
                          disabled={isPortionFinalized}
                          placeholder="Enter text"
                          className="w-full px-2.5 py-1 text-xs font-bold rounded-lg border border-[#C4B9A3] bg-[#F4EFE3] text-[#111311] disabled:bg-slate-200 disabled:cursor-not-allowed"
                          required={test.isRequired}
                        />
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Action Buttons */}
          {!isPortionFinalized && (
            <div className="flex items-center justify-end space-x-3 pt-4 border-t border-[#C4B9A3]">
              <button
                type="button"
                onClick={handleSaveDraft}
                disabled={isSubmitting}
                className="flex items-center space-x-1.5 px-4 py-2.5 rounded-xl bg-[#F4EFE3] hover:bg-amber-100 text-slate-800 font-extrabold text-xs border border-[#C4B9A3] transition"
              >
                <Save className="w-4 h-4 text-slate-700" />
                <span>Save Draft</span>
              </button>
              <button
                type="button"
                onClick={handleCompleteLabTest}
                disabled={isSubmitting}
                className="flex items-center space-x-1.5 px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-extrabold text-xs shadow-md border border-emerald-950 transition"
              >
                <CheckCircle2 className="w-4 h-4 text-white" />
                <span>{isSubmitting ? 'Evaluating Test...' : 'Complete Lab Test for Portion'}</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
