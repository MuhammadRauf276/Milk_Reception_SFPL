'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Header } from '@modules/shared/Header';
import { HierarchicalNavDrawer } from '@modules/shared/navigation/HierarchicalNavDrawer';
import { User } from '@core/types';
import { ShieldCheck, Plus, Filter, CheckCircle2, AlertTriangle, XCircle, ArrowUpRight, History } from 'lucide-react';

interface LabTest {
  id: string;
  testCode: string;
  testName: string;
  resultType: string;
  unit: string | null;
}

interface SopRule {
  id: string;
  labTestId: string;
  testCode: string;
  testName: string;
  resultType: string;
  testingPoint: string;
  version: number;
  ruleCategory: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  minValue: number | null;
  maxValue: number | null;
  acceptableOption: string | null;
  warningTrigger: string | null;
  decisionConsequence: string | null;
  isActive: boolean;
}

const TESTING_POINTS = [
  { value: 'PLANT_QA', label: 'Plant QA Reception' },
  { value: 'ZMCC_LAB_MOT', label: 'ZMCC Lab (MOT Arrivals)' },
  { value: 'ZMCC_LAB_CONTRACTOR', label: 'ZMCC Lab (Contractor)' },
  { value: 'ZMCC_LAB_LOCAL_SUPPLIER', label: 'ZMCC Lab (Local Supplier)' },
  { value: 'DISPATCH', label: 'ZMCC Dispatch to Plant' },
  { value: 'MOT_SHOP', label: 'MOT Shop Collection' },
];

export default function QAHeadDepartmentPage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const hamburgerButtonRef = useRef<HTMLButtonElement | null>(null);

  const [rules, setRules] = useState<SopRule[]>([]);
  const [tests, setTests] = useState<LabTest[]>([]);
  const [selectedPoint, setSelectedPoint] = useState<string>('PLANT_QA');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form states
  const [formTestId, setFormTestId] = useState('');
  const [formTestingPoint, setFormTestingPoint] = useState('PLANT_QA');
  const [formCategory, setFormCategory] = useState<'RELEASE' | 'MONITORING'>('RELEASE');
  const [formMinValue, setFormMinValue] = useState('');
  const [formMaxValue, setFormMaxValue] = useState('');
  const [formAcceptableOption, setFormAcceptableOption] = useState('');
  const [formWarningTrigger, setFormWarningTrigger] = useState('');
  const [formDecisionConsequence, setFormDecisionConsequence] = useState('');

  const loadData = useCallback(async () => {
    try {
      const [rulesRes, testsRes] = await Promise.all([
        fetch(`/api/qa-head/sop-rules?testingPoint=${selectedPoint}`),
        fetch('/api/lab-tests'),
      ]);

      if (rulesRes.ok) {
        const rData = await rulesRes.json();
        setRules(rData.rules || []);
      }
      if (testsRes.ok) {
        const tData = await testsRes.json();
        setTests(tData.tests || tData || []);
      }
    } catch (err) {
      console.error('Failed to load rules or tests', err);
    }
  }, [selectedPoint]);

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

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!formTestId) {
      setFormError('Please select a Lab Test.');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        labTestId: formTestId,
        testingPoint: formTestingPoint,
        ruleCategory: formCategory,
        minValue: formMinValue ? parseFloat(formMinValue) : null,
        maxValue: formMaxValue ? parseFloat(formMaxValue) : null,
        acceptableOption: formAcceptableOption.trim() || null,
        warningTrigger: formWarningTrigger.trim() || null,
        decisionConsequence: formDecisionConsequence.trim() || null,
      };

      const res = await fetch('/api/qa-head/sop-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to create SOP rule.');
      }

      setIsModalOpen(false);
      setFormTestId('');
      setFormMinValue('');
      setFormMaxValue('');
      setFormAcceptableOption('');
      setFormWarningTrigger('');
      setFormDecisionConsequence('');
      await loadData();
    } catch (err: any) {
      setFormError(err.message || 'Error creating rule.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-xs font-bold text-slate-500">Loading QA Head Station...</div>;
  }

  return (
    <div className="min-h-screen bg-[#FDFBF9] text-[#111311] flex flex-col font-sans w-full max-w-full overflow-x-hidden">
      <Header
        currentUser={user}
        title="QA Head — SOP Quality Rules"
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
        {/* Header Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-xl border border-[#EAE4D5] shadow-xs">
          <div>
            <h1 className="text-xl font-black text-slate-900 flex items-center gap-2">
              <ShieldCheck className="w-6 h-6 text-[#1A4D2E]" />
              SOP Quality Rules & Threshold Governance
            </h1>
            <p className="text-xs text-slate-600 mt-1">
              Authoritative management of laboratory test acceptance criteria, numeric bounds, and managerial exception consequences.
            </p>
          </div>
          <button
            onClick={() => {
              setFormTestingPoint(selectedPoint);
              setIsModalOpen(true);
            }}
            className="flex items-center justify-center gap-2 bg-[#1A4D2E] text-white px-4 py-2.5 rounded-lg text-xs font-bold hover:bg-[#153e25] transition shadow-xs"
          >
            <Plus className="w-4 h-4" />
            Create SOP Rule Version
          </button>
        </div>

        {/* Testing Point Selector Tabs */}
        <div className="flex gap-2 overflow-x-auto pb-2">
          {TESTING_POINTS.map((tp) => (
            <button
              key={tp.value}
              onClick={() => setSelectedPoint(tp.value)}
              className={`px-4 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition border ${
                selectedPoint === tp.value
                  ? 'bg-[#1A4D2E] text-white border-[#1A4D2E] shadow-xs'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {tp.label}
            </button>
          ))}
        </div>

        {/* Rules Table */}
        <div className="bg-white rounded-xl border border-[#EAE4D5] overflow-hidden shadow-xs">
          <div className="px-6 py-4 border-b border-[#EAE4D5] flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-800">
              Active & Historic SOP Rules for {TESTING_POINTS.find((tp) => tp.value === selectedPoint)?.label}
            </h2>
            <span className="text-xs text-slate-500 font-medium">
              {rules.length} {rules.length === 1 ? 'rule' : 'rules'} found
            </span>
          </div>

          {rules.length === 0 ? (
            <div className="p-12 text-center text-slate-500 space-y-2">
              <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto" />
              <p className="text-sm font-bold text-slate-700">No SOP rules found for this testing point.</p>
              <p className="text-xs text-slate-500">Click &quot;Create SOP Rule Version&quot; above to establish quality threshold criteria.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200 uppercase tracking-wider">
                  <tr>
                    <th className="px-6 py-3">Test</th>
                    <th className="px-4 py-3">Version</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Numeric Bounds (Min - Max)</th>
                    <th className="px-4 py-3">Acceptable Option</th>
                    <th className="px-4 py-3">Consequence</th>
                    <th className="px-4 py-3">Effective Date</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                  {rules.map((rule) => (
                    <tr key={rule.id} className="hover:bg-slate-50/80 transition">
                      <td className="px-6 py-3">
                        <div className="font-bold text-slate-900">{rule.testName}</div>
                        <div className="text-[10px] text-slate-400 font-mono">{rule.testCode} ({rule.resultType})</div>
                      </td>
                      <td className="px-4 py-3 font-mono font-bold text-blue-700">v{rule.version}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          rule.ruleCategory === 'RELEASE' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'
                        }`}>
                          {rule.ruleCategory}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono">
                        {rule.minValue !== null || rule.maxValue !== null ? (
                          <span>
                            {rule.minValue !== null ? rule.minValue : '—'} &nbsp;to&nbsp;{' '}
                            {rule.maxValue !== null ? rule.maxValue : '—'}
                          </span>
                        ) : (
                          <span className="text-slate-400">N/A (Qualitative)</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {rule.acceptableOption ? (
                          <span className="font-semibold text-emerald-700">{rule.acceptableOption}</span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-slate-600 font-mono text-[11px]">{rule.decisionConsequence || 'OUT_OF_SPEC'}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-500 font-mono text-[11px]">
                        {new Date(rule.effectiveFrom).toLocaleDateString('en-PK')}
                      </td>
                      <td className="px-4 py-3">
                        {rule.isActive ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded text-[10px] font-bold">
                            <CheckCircle2 className="w-3 h-3" /> Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-slate-500 bg-slate-100 px-2 py-0.5 rounded text-[10px] font-bold">
                            <History className="w-3 h-3" /> Superseded
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* Modal for Creating New Rule Version */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 border border-slate-200 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-[#1A4D2E]" />
                Publish New SOP Rule Version
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                &times;
              </button>
            </div>

            {formError && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg flex items-center gap-2">
                <XCircle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleCreateRule} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Testing Point</label>
                <select
                  value={formTestingPoint}
                  onChange={(e) => setFormTestingPoint(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg p-2.5 font-medium text-slate-800"
                >
                  {TESTING_POINTS.map((tp) => (
                    <option key={tp.value} value={tp.value}>
                      {tp.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Lab Test</label>
                <select
                  value={formTestId}
                  onChange={(e) => setFormTestId(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg p-2.5 font-medium text-slate-800"
                >
                  <option value="">-- Select Lab Test --</option>
                  {tests.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.testName} ({t.testCode}) — {t.resultType}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Rule Category</label>
                <select
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value as 'RELEASE' | 'MONITORING')}
                  className="w-full border border-slate-300 rounded-lg p-2.5 font-medium text-slate-800"
                >
                  <option value="RELEASE">RELEASE (Blocking if Out-of-Spec)</option>
                  <option value="MONITORING">MONITORING (Advisory / Non-blocking)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Min Value (Numeric)</label>
                  <input
                    type="number"
                    step="any"
                    value={formMinValue}
                    onChange={(e) => setFormMinValue(e.target.value)}
                    placeholder="e.g. 28.0"
                    className="w-full border border-slate-300 rounded-lg p-2.5"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Max Value (Numeric)</label>
                  <input
                    type="number"
                    step="any"
                    value={formMaxValue}
                    onChange={(e) => setFormMaxValue(e.target.value)}
                    placeholder="e.g. 32.0"
                    className="w-full border border-slate-300 rounded-lg p-2.5"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Acceptable Option (Qualitative)</label>
                <input
                  type="text"
                  value={formAcceptableOption}
                  onChange={(e) => setFormAcceptableOption(e.target.value)}
                  placeholder="e.g. NEGATIVE or PASS"
                  className="w-full border border-slate-300 rounded-lg p-2.5"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Warning Trigger (Optional)</label>
                <input
                  type="text"
                  value={formWarningTrigger}
                  onChange={(e) => setFormWarningTrigger(e.target.value)}
                  placeholder="e.g. BORDERLINE"
                  className="w-full border border-slate-300 rounded-lg p-2.5"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Decision Consequence</label>
                <input
                  type="text"
                  value={formDecisionConsequence}
                  onChange={(e) => setFormDecisionConsequence(e.target.value)}
                  placeholder="Default: OUT_OF_SPEC"
                  className="w-full border border-slate-300 rounded-lg p-2.5"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-slate-600 font-bold hover:bg-slate-100 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="bg-[#1A4D2E] text-white px-5 py-2 rounded-lg font-bold hover:bg-[#153e25] transition disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : 'Publish Version'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
