'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { User } from '@core/types';
import { useToast } from '@/frontend/context/ToastContext';
import {
  FlaskConical,
  CheckCircle,
  XCircle,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Building,
  Store,
  Factory,
  Sliders,
  AlertTriangle,
} from 'lucide-react';
import {
  TestingPoint,
  SerializedPolicyAssignment,
} from '@/types/milk-test-policy';

export type StationKey = 'PLANT_QA' | 'DISPATCH' | 'ZMCC_LAB' | 'MOT_SHOP';

interface LabTestOption {
  id: string;
  testCode: string;
  testName: string;
  resultType: string;
  unit: string | null;
  displayOrder: number;
  isActive: boolean;
  resultOptions?: Array<{ value: string; label: string; isPassing?: boolean | null }> | null;
}

interface SopRuleItem {
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

interface MilkTestPolicyWorkspaceProps {
  currentUser: User | null;
}

export const STATION_METADATA: Record<
  StationKey,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    testingPoints: readonly TestingPoint[];
  }
> = {
  PLANT_QA: {
    label: 'Plant QA Reception',
    icon: ShieldCheck,
    testingPoints: ['PLANT_QA'],
  },
  DISPATCH: {
    label: 'ZMCC Dispatch to Factory',
    icon: Factory,
    testingPoints: ['DISPATCH'],
  },
  ZMCC_LAB: {
    label: 'ZMCC Lab Reception',
    icon: Building,
    testingPoints: ['ZMCC_LAB_MOT', 'ZMCC_LAB_LOCAL_SUPPLIER'],
  },
  MOT_SHOP: {
    label: 'MOT Shop Collection',
    icon: Store,
    testingPoints: ['MOT_SHOP'],
  },
};

export const MilkTestPolicyWorkspace: React.FC<MilkTestPolicyWorkspaceProps> = ({ currentUser }) => {
  const toast = useToast();
  const isSuperAdminOrDataExec =
    currentUser?.role === 'SUPER_ADMIN' || currentUser?.role === 'DATA_EXECUTIVE';

  const allowedStations: StationKey[] = isSuperAdminOrDataExec
    ? ['PLANT_QA', 'DISPATCH', 'ZMCC_LAB', 'MOT_SHOP']
    : ['DISPATCH', 'ZMCC_LAB', 'MOT_SHOP'];

  const [activeStation, setActiveStation] = useState<StationKey>(allowedStations[0] || 'PLANT_QA');
  const [policies, setPolicies] = useState<SerializedPolicyAssignment[]>([]);
  const [activeRules, setActiveRules] = useState<Record<string, SopRuleItem>>({});
  const [labTests, setLabTests] = useState<LabTestOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showActiveOnly, setShowActiveOnly] = useState(false);

  // Assign Test Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedLabTestId, setSelectedLabTestId] = useState('');
  const [modalIsRequired, setModalIsRequired] = useState(true);
  const [modalDisplayOrder, setModalDisplayOrder] = useState<number>(10);
  const [modalMinValue, setModalMinValue] = useState<string>('');
  const [modalMaxValue, setModalMaxValue] = useState<string>('');
  const [modalAcceptableOption, setModalAcceptableOption] = useState<string>('');
  const [modalReason, setModalReason] = useState<string>('Authoritative acceptance criteria set by Data Executive');
  const [submitting, setSubmitting] = useState(false);

  // Edit Acceptance Criteria Modal State
  const [isCriteriaModalOpen, setIsCriteriaModalOpen] = useState(false);
  const [criteriaTargetPolicy, setCriteriaTargetPolicy] = useState<SerializedPolicyAssignment | null>(null);
  const [criteriaMinValue, setCriteriaMinValue] = useState<string>('');
  const [criteriaMaxValue, setCriteriaMaxValue] = useState<string>('');
  const [criteriaAcceptableOption, setCriteriaAcceptableOption] = useState<string>('');
  const [criteriaReason, setCriteriaReason] = useState<string>('Authoritative acceptance criteria updated by Data Executive');
  const [criteriaSubmitting, setCriteriaSubmitting] = useState(false);

  // Fetch policies and active SOP rules for current station
  const fetchPoliciesAndRules = useCallback(async () => {
    setLoading(true);
    try {
      const targetPoints = STATION_METADATA[activeStation].testingPoints;

      // 1. Fetch policies
      const policyPromises = targetPoints.map((pt) =>
        fetch(`/api/milk-test-policies?testingPoint=${pt}`)
          .then((res) => (res.ok ? res.json() : { policies: [] }))
          .catch(() => ({ policies: [] }))
      );
      const policyResults = await Promise.all(policyPromises);

      // Deduplicate assignments across synchronized testing points
      const combinedPolicies: SerializedPolicyAssignment[] = [];
      const seenTestIds = new Set<string>();
      for (const res of policyResults) {
        for (const pol of (res.policies || []) as SerializedPolicyAssignment[]) {
          if (!seenTestIds.has(pol.labTestId)) {
            seenTestIds.add(pol.labTestId);
            combinedPolicies.push(pol);
          }
        }
      }
      setPolicies(combinedPolicies.sort((a, b) => a.displayOrder - b.displayOrder || Number(a.id) - Number(b.id)));

      // 2. Fetch active SOP rules for criteria display
      const rulePromises = targetPoints.map((pt) =>
        fetch(`/api/qa-head/sop-rules?testingPoint=${pt}&isActive=true`)
          .then((res) => (res.ok ? res.json() : { rules: [] }))
          .catch(() => ({ rules: [] }))
      );
      const ruleResults = await Promise.all(rulePromises);

      const rulesMap: Record<string, SopRuleItem> = {};
      for (const res of ruleResults) {
        for (const rule of (res.rules || []) as SopRuleItem[]) {
          if (!rulesMap[rule.labTestId]) {
            rulesMap[rule.labTestId] = rule;
          }
        }
      }
      setActiveRules(rulesMap);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error loading policies and acceptance rules';
      toast.showError(msg);
    } finally {
      setLoading(false);
    }
  }, [activeStation, toast]);

  // Fetch all active lab tests for selection
  const fetchLabTests = useCallback(async () => {
    try {
      const res = await fetch('/api/lab-tests?activeOnly=true');
      if (res.ok) {
        const data = await res.json();
        const tests: LabTestOption[] = Array.isArray(data) ? data : data.tests || [];
        setLabTests(tests.filter((t) => t.isActive));
      }
    } catch (err) {
      console.error('Error fetching lab tests catalogue', err);
    }
  }, []);

  useEffect(() => {
    fetchPoliciesAndRules();
  }, [fetchPoliciesAndRules]);

  useEffect(() => {
    fetchLabTests();
  }, [fetchLabTests]);

  const handleToggleActive = async (policy: SerializedPolicyAssignment) => {
    const newStatus = !policy.isActive;
    try {
      const res = await fetch(`/api/milk-test-policies/${policy.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: newStatus }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to update policy status');
      }
      const updated = await res.json();
      setPolicies((prev) => prev.map((p) => (p.id === policy.id ? updated.policy : p)));
      toast.showSuccess(
        `Test "${policy.labTest?.testName || policy.labTestId}" ${newStatus ? 'activated' : 'deactivated'} for ${STATION_METADATA[activeStation].label}.`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update status';
      toast.showError(msg);
    }
  };

  const handleOpenCriteriaModal = (policy: SerializedPolicyAssignment) => {
    setCriteriaTargetPolicy(policy);
    const existingRule = activeRules[policy.labTestId];
    if (existingRule) {
      setCriteriaMinValue(existingRule.minValue !== null ? String(existingRule.minValue) : '');
      setCriteriaMaxValue(existingRule.maxValue !== null ? String(existingRule.maxValue) : '');
      setCriteriaAcceptableOption(existingRule.acceptableOption || '');
    } else {
      setCriteriaMinValue('');
      setCriteriaMaxValue('');
      setCriteriaAcceptableOption('');
    }
    setCriteriaReason('Authoritative acceptance criteria updated by Data Executive');
    setIsCriteriaModalOpen(true);
  };

  const handleSaveCriteria = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!criteriaTargetPolicy) return;
    setCriteriaSubmitting(true);
    try {
      const targetPoints = STATION_METADATA[activeStation].testingPoints;
      for (const pt of targetPoints) {
        const res = await fetch('/api/qa-head/sop-rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            labTestId: criteriaTargetPolicy.labTestId,
            testingPoint: pt,
            ruleCategory: 'RELEASE',
            minValue: criteriaMinValue !== '' ? parseFloat(criteriaMinValue) : null,
            maxValue: criteriaMaxValue !== '' ? parseFloat(criteriaMaxValue) : null,
            acceptableOption: criteriaAcceptableOption.trim() || null,
            reason: criteriaReason.trim() || 'Authoritative acceptance criteria updated by Data Executive',
          }),
        });
        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error || `Failed to configure criteria for ${pt}`);
        }
      }

      toast.showSuccess(
        `Acceptance criteria updated for "${criteriaTargetPolicy.labTest?.testName || criteriaTargetPolicy.labTestId}" across ${STATION_METADATA[activeStation].label}.`
      );
      setIsCriteriaModalOpen(false);
      await fetchPoliciesAndRules();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save acceptance criteria';
      toast.showError(msg);
    } finally {
      setCriteriaSubmitting(false);
    }
  };

  const handleToggleRequired = async (policy: SerializedPolicyAssignment) => {
    const newRequired = !policy.isRequired;

    // If making required, ensure an active RELEASE rule exists first
    if (newRequired && !activeRules[policy.labTestId]) {
      toast.showError(`A valid acceptance criteria rule is required before activating "${policy.labTest?.testName}". Please configure criteria first.`);
      handleOpenCriteriaModal(policy);
      return;
    }

    try {
      const res = await fetch(`/api/milk-test-policies/${policy.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isRequired: newRequired }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to update requirement');
      }
      const updated = await res.json();
      setPolicies((prev) => prev.map((p) => (p.id === policy.id ? updated.policy : p)));
      toast.showSuccess(
        `Test "${policy.labTest?.testName || policy.labTestId}" is now ${newRequired ? 'Required' : 'Optional'}.`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update requirement';
      toast.showError(msg);
    }
  };

  const handleUpdateDisplayOrder = async (policy: SerializedPolicyAssignment, newOrder: number) => {
    if (newOrder === policy.displayOrder) return;
    try {
      const res = await fetch(`/api/milk-test-policies/${policy.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayOrder: newOrder }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to update display order');
      }
      const updated = await res.json();
      setPolicies((prev) =>
        prev
          .map((p) => (p.id === policy.id ? updated.policy : p))
          .sort((a, b) => a.displayOrder - b.displayOrder || Number(a.id) - Number(b.id))
      );
      toast.showSuccess(`Display order updated for "${policy.labTest?.testName || policy.labTestId}".`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update display order';
      toast.showError(msg);
    }
  };

  const handleAddPolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLabTestId) {
      toast.showError('Please select a test from the catalogue.');
      return;
    }

    setSubmitting(true);
    try {
      const targetPoints = STATION_METADATA[activeStation].testingPoints;

      // 1. If test is required or criteria provided, create/supersede RELEASE rule across all target points
      const hasCriteria =
        modalMinValue !== '' || modalMaxValue !== '' || modalAcceptableOption.trim() !== '';

      if (modalIsRequired || hasCriteria) {
        for (const pt of targetPoints) {
          const ruleRes = await fetch('/api/qa-head/sop-rules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              labTestId: selectedLabTestId,
              testingPoint: pt,
              ruleCategory: 'RELEASE',
              minValue: modalMinValue !== '' ? parseFloat(modalMinValue) : null,
              maxValue: modalMaxValue !== '' ? parseFloat(modalMaxValue) : null,
              acceptableOption: modalAcceptableOption.trim() || null,
              reason: modalReason.trim() || 'Authoritative acceptance criteria set by Data Executive',
            }),
          });
          if (!ruleRes.ok) {
            const errData = await ruleRes.json();
            throw new Error(errData.error || `Failed to create acceptance rule for ${pt}`);
          }
        }
      }

      // 2. Assign policy across all target points
      for (const pt of targetPoints) {
        const res = await fetch('/api/milk-test-policies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            labTestId: selectedLabTestId,
            testingPoint: pt,
            isRequired: modalIsRequired,
            displayOrder: modalDisplayOrder,
          }),
        });

        if (!res.ok) {
          const err = await res.json();
          // If conflict (already assigned in counterpart point), continue gracefully
          if (res.status !== 409) {
            throw new Error(err.error || `Failed to assign test policy to ${pt}`);
          }
        }
      }

      toast.showSuccess(
        `Assigned test to ${STATION_METADATA[activeStation].label} with quality acceptance criteria.`
      );
      setIsAddModalOpen(false);
      setSelectedLabTestId('');
      setModalMinValue('');
      setModalMaxValue('');
      setModalAcceptableOption('');
      await fetchPoliciesAndRules();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to assign test policy';
      toast.showError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // Filter out tests already assigned in current station
  const assignedTestIds = new Set(policies.map((p) => p.labTestId));
  const availableLabTests = labTests.filter((t) => !assignedTestIds.has(t.id));
  const selectedTestObj = labTests.find((t) => t.id === selectedLabTestId);

  const filteredPolicies = policies.filter((p) => {
    if (showActiveOnly && !p.isActive) return false;
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    return (
      p.labTest?.testName.toLowerCase().includes(term) ||
      p.labTest?.testCode.toLowerCase().includes(term) ||
      p.labTest?.resultType.toLowerCase().includes(term)
    );
  });

  const activeMetadata = STATION_METADATA[activeStation];
  const ActiveIcon = activeMetadata.icon;

  const isNumericTestType = (type?: string) =>
    ['NUMERIC', 'INTEGER', 'DECIMAL'].includes(type || '');

  return (
    <div className="space-y-6">
      {/* HEADER BANNER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-[#EAE4D5] shadow-xs">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-[#1E3A8A] text-white rounded-xl">
            <FlaskConical className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-black tracking-tight text-[#111311]">
              Milk Test Policies & Acceptance Criteria
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={fetchPoliciesAndRules}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-xl border border-[#EAE4D5] bg-[#FDFBF9] text-slate-700 hover:bg-[#F4F0E6] transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          <button
            onClick={() => {
              const maxOrder = policies.reduce((max, p) => Math.max(max, p.displayOrder), 0);
              setModalDisplayOrder(maxOrder + 10);
              setSelectedLabTestId('');
              setModalMinValue('');
              setModalMaxValue('');
              setModalAcceptableOption('');
              setIsAddModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-xl bg-[#1E3A8A] text-white hover:bg-blue-900 transition shadow-xs"
          >
            <Plus className="w-4 h-4" />
            <span>Assign Test</span>
          </button>
        </div>
      </div>

      {/* 4 RECEPTION STATION TABS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {allowedStations.map((station) => {
          const meta = STATION_METADATA[station];
          const Icon = meta.icon;
          const isSelected = activeStation === station;
          return (
            <button
              key={station}
              onClick={() => setActiveStation(station)}
              className={`flex flex-col p-3.5 rounded-xl border text-left transition ${
                isSelected
                  ? 'bg-[#1E3A8A] text-white border-[#1E3A8A] shadow-sm'
                  : 'bg-white text-slate-800 border-[#EAE4D5] hover:bg-[#FDFBF9]'
              }`}
            >
              <div className="flex items-center justify-between w-full mb-1.5">
                <Icon className={`w-4 h-4 ${isSelected ? 'text-white' : 'text-[#1E3A8A]'}`} />
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded font-black ${
                    isSelected ? 'bg-blue-800 text-white' : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {station === activeStation ? policies.length : '-'}
                </span>
              </div>
              <span className="text-xs font-black truncate">{meta.label}</span>
              <span
                className={`text-[10px] truncate mt-0.5 ${
                  isSelected ? 'text-blue-100' : 'text-slate-600'
                }`}
              >
                {station}
              </span>
            </button>
          );
        })}
      </div>

      {/* SEARCH AND FILTER BAR */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search assigned tests..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-[#EAE4D5] bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
          />
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showActiveOnly}
              onChange={(e) => setShowActiveOnly(e.target.checked)}
              className="rounded border-slate-300 text-[#1E3A8A] focus:ring-[#1E3A8A]"
            />
            <span>Active Tests Only</span>
          </label>
        </div>
      </div>

      {/* POLICY ASSIGNMENT & CRITERIA TABLE */}
      <div className="bg-white rounded-2xl border border-[#EAE4D5] overflow-hidden shadow-xs">
        {loading ? (
          <div className="p-12 text-center text-xs font-bold text-slate-600">
            <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-[#1E3A8A]" />
            Loading test policies & acceptance criteria...
          </div>
        ) : filteredPolicies.length === 0 ? (
          <div className="p-12 text-center">
            <FlaskConical className="w-8 h-8 mx-auto text-slate-300 mb-2" />
            <h3 className="text-sm font-bold text-slate-700">No Policy Assignments</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              No tests are currently assigned to {activeMetadata.label}. Click "Assign Test" above to configure testing requirements and acceptance criteria.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#FDFBF9] border-b border-[#EAE4D5] text-slate-600 uppercase font-black tracking-wider text-[10px]">
                  <th className="py-3 px-4 w-16">Order</th>
                  <th className="py-3 px-4">Test Code & Name</th>
                  <th className="py-3 px-4">Type / Unit</th>
                  <th className="py-3 px-4">Requirement</th>
                  <th className="py-3 px-4">Quality Acceptance Criteria</th>
                  <th className="py-3 px-4">Policy Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EAE4D5]">
                {filteredPolicies.map((policy) => {
                  const isRowActive = policy.isActive;
                  const rule = activeRules[policy.labTestId];
                  const isNumeric = isNumericTestType(policy.labTest?.resultType);

                  return (
                    <tr
                      key={policy.id}
                      className={`hover:bg-[#FDFBF9] transition ${
                        !isRowActive ? 'opacity-50 bg-slate-50/60' : ''
                      }`}
                    >
                      {/* Display Order */}
                      <td className="py-3 px-4 font-mono font-bold text-slate-700">
                        <input
                          type="number"
                          defaultValue={policy.displayOrder}
                          onBlur={(e) => {
                            const val = parseInt(e.target.value, 10);
                            if (!isNaN(val)) handleUpdateDisplayOrder(policy, val);
                          }}
                          className="w-14 px-1.5 py-1 text-xs border border-slate-200 rounded font-mono text-center focus:ring-1 focus:ring-[#1E3A8A]"
                        />
                      </td>

                      {/* Test Code & Name */}
                      <td className="py-3 px-4">
                        <div className="font-extrabold text-[#111311]">
                          {policy.labTest?.testName || 'Unknown Test'}
                        </div>
                        <div className="font-mono text-[10px] text-slate-500">
                          {policy.labTest?.testCode || policy.labTestId}
                        </div>
                      </td>

                      {/* Result Type & Unit */}
                      <td className="py-3 px-4">
                        <span className="font-semibold text-slate-700">
                          {policy.labTest?.resultType || '-'}
                        </span>
                        {policy.labTest?.unit && (
                          <span className="text-slate-500 text-[10px] block font-mono">
                            {policy.labTest.unit}
                          </span>
                        )}
                      </td>

                      {/* Requirement */}
                      <td className="py-3 px-4">
                        <button
                          type="button"
                          onClick={() => handleToggleRequired(policy)}
                          className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider transition ${
                            policy.isRequired
                              ? 'bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200'
                              : 'bg-slate-100 text-slate-700 border border-slate-300 hover:bg-slate-200'
                          }`}
                          title="Click to toggle Required / Optional"
                        >
                          {policy.isRequired ? 'Required' : 'Optional'}
                        </button>
                      </td>

                      {/* Quality Acceptance Criteria Badge & Edit Button */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          {rule ? (
                            isNumeric ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-blue-50 border border-blue-200 text-blue-900 font-mono text-[11px] font-bold">
                                {rule.minValue !== null || rule.maxValue !== null ? (
                                  <>
                                    Range: {rule.minValue ?? '-'} to {rule.maxValue ?? '-'}{' '}
                                    {policy.labTest?.unit || ''}
                                  </>
                                ) : (
                                  'Unspecified Range'
                                )}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-900 font-mono text-[11px] font-bold">
                                Accept: {rule.acceptableOption || 'Any'}
                              </span>
                            )
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-[11px] font-medium">
                              <AlertTriangle className="w-3 h-3 text-rose-500 shrink-0" />
                              Not Configured
                            </span>
                          )}

                          <button
                            type="button"
                            onClick={() => handleOpenCriteriaModal(policy)}
                            className="p-1 rounded-md text-slate-500 hover:text-[#1E3A8A] hover:bg-slate-100 transition"
                            title="Edit Quality Acceptance Criteria"
                          >
                            <Sliders className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>

                      {/* Policy Status */}
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${
                            policy.isActive
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {policy.isActive ? (
                            <>
                              <CheckCircle className="w-3 h-3" /> Active
                            </>
                          ) : (
                            <>
                              <XCircle className="w-3 h-3" /> Inactive
                            </>
                          )}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => handleToggleActive(policy)}
                          className={`px-2.5 py-1 text-xs font-bold rounded-lg border transition ${
                            policy.isActive
                              ? 'border-rose-200 text-rose-700 hover:bg-rose-50'
                              : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                          }`}
                        >
                          {policy.isActive ? 'Deactivate' : 'Reactivate'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* UNIFIED ASSIGN TEST MODAL WITH ACCEPTANCE CRITERIA */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl border border-[#EAE4D5] shadow-2xl max-w-lg w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-[#EAE4D5]">
              <div className="flex items-center gap-2">
                <FlaskConical className="w-5 h-5 text-[#1E3A8A]" />
                <h3 className="font-black text-base text-[#111311]">
                  Assign Test & Define Criteria — {activeMetadata.label}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddPolicy} className="space-y-4 text-xs">
              {/* Select Lab Test */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Select Laboratory Test <span className="text-rose-600">*</span>
                </label>
                {availableLabTests.length === 0 ? (
                  <p className="text-xs text-amber-700 bg-amber-50 p-2.5 rounded-lg border border-amber-200 font-medium">
                    All active tests in the master catalogue are already assigned to this station.
                  </p>
                ) : (
                  <select
                    value={selectedLabTestId}
                    onChange={(e) => {
                      const newId = e.target.value;
                      setSelectedLabTestId(newId);
                      const tObj = labTests.find((t) => t.id === newId);
                      if (tObj && isNumericTestType(tObj.resultType)) {
                        setModalAcceptableOption('');
                      }
                    }}
                    required
                    className="w-full p-2.5 rounded-xl border border-[#EAE4D5] bg-white text-xs font-bold focus:ring-2 focus:ring-[#1E3A8A]"
                  >
                    <option value="">-- Choose a test from catalogue --</option>
                    {availableLabTests.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.testName} ({t.testCode}) — {t.resultType} {t.unit ? `[${t.unit}]` : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Requirement & Display Order */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Display Order</label>
                  <input
                    type="number"
                    value={modalDisplayOrder}
                    onChange={(e) => setModalDisplayOrder(parseInt(e.target.value, 10) || 0)}
                    className="w-full p-2.5 rounded-xl border border-[#EAE4D5] text-xs font-mono font-bold"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Requirement</label>
                  <label className="flex items-center gap-2 p-2.5 rounded-xl border border-[#EAE4D5] cursor-pointer mt-0.5">
                    <input
                      type="checkbox"
                      checked={modalIsRequired}
                      onChange={(e) => setModalIsRequired(e.target.checked)}
                      className="rounded text-[#1E3A8A] focus:ring-[#1E3A8A]"
                    />
                    <span className="font-bold text-slate-800">Required Test</span>
                  </label>
                </div>
              </div>

              {/* Quality Acceptance Criteria Definition */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                <div className="flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-[#1E3A8A]" />
                  <span className="font-black text-slate-800">Direct Quality Acceptance Criteria</span>
                </div>

                {selectedTestObj && isNumericTestType(selectedTestObj.resultType) ? (
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      Acceptable Range ({selectedTestObj.unit || 'Numeric'})
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-[10px] text-slate-500 block mb-0.5">Min Value</span>
                        <input
                          type="number"
                          step="any"
                          placeholder="e.g. 3.5"
                          value={modalMinValue}
                          onChange={(e) => setModalMinValue(e.target.value)}
                          className="w-full p-2 rounded-lg border border-slate-300 font-mono text-xs"
                        />
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 block mb-0.5">Max Value</span>
                        <input
                          type="number"
                          step="any"
                          placeholder="e.g. 5.0"
                          value={modalMaxValue}
                          onChange={(e) => setModalMaxValue(e.target.value)}
                          className="w-full p-2 rounded-lg border border-slate-300 font-mono text-xs"
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      Acceptable Option (Qualitative / Sensory)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. NEGATIVE, NORMAL, CLEAN, SWEET"
                      value={modalAcceptableOption}
                      onChange={(e) => setModalAcceptableOption(e.target.value)}
                      className="w-full p-2 rounded-lg border border-slate-300 font-mono text-xs uppercase"
                    />
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {['NEGATIVE', 'POSITIVE', 'NORMAL', 'CLEAN', 'SWEET', 'PASS', 'OK'].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setModalAcceptableOption(preset)}
                          className="px-2 py-0.5 text-[10px] font-mono font-bold bg-white border border-slate-300 rounded hover:bg-slate-100"
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Governance Audit Reason</label>
                  <input
                    type="text"
                    value={modalReason}
                    onChange={(e) => setModalReason(e.target.value)}
                    required
                    className="w-full p-2 rounded-lg border border-slate-300 text-xs"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#EAE4D5]">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 text-xs font-bold rounded-xl border border-[#EAE4D5] bg-[#FDFBF9] hover:bg-[#F4F0E6] text-slate-700 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || availableLabTests.length === 0}
                  className="px-4 py-2 text-xs font-bold rounded-xl bg-[#1E3A8A] text-white hover:bg-blue-900 transition disabled:opacity-50"
                >
                  {submitting ? 'Assigning...' : 'Assign to Policy & Save Criteria'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DEDICATED EDIT CRITERIA MODAL */}
      {isCriteriaModalOpen && criteriaTargetPolicy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl border border-[#EAE4D5] shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#EAE4D5]">
              <div className="flex items-center gap-2">
                <Sliders className="w-5 h-5 text-[#1E3A8A]" />
                <h3 className="font-black text-base text-[#111311]">
                  Configure Acceptance Criteria
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsCriteriaModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="bg-blue-50/50 p-3 rounded-xl border border-blue-200/60 space-y-1">
              <div className="text-xs font-black text-blue-950">
                {criteriaTargetPolicy.labTest?.testName} ({criteriaTargetPolicy.labTest?.testCode})
              </div>
              <div className="text-[11px] text-blue-800">
                Station: <span className="font-bold">{activeMetadata.label}</span>
              </div>
              <div className="text-[11px] text-blue-700 font-mono">
                Type: {criteriaTargetPolicy.labTest?.resultType}{' '}
                {criteriaTargetPolicy.labTest?.unit ? `[${criteriaTargetPolicy.labTest.unit}]` : ''}
              </div>
            </div>

            <form onSubmit={handleSaveCriteria} className="space-y-4 text-xs">
              {isNumericTestType(criteriaTargetPolicy.labTest?.resultType) ? (
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Acceptable Range ({criteriaTargetPolicy.labTest?.unit || 'Numeric'})
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-[10px] text-slate-500 block mb-0.5">Min Value</span>
                      <input
                        type="number"
                        step="any"
                        placeholder="e.g. 3.5"
                        value={criteriaMinValue}
                        onChange={(e) => setCriteriaMinValue(e.target.value)}
                        className="w-full p-2.5 rounded-xl border border-[#EAE4D5] font-mono text-xs"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block mb-0.5">Max Value</span>
                      <input
                        type="number"
                        step="any"
                        placeholder="e.g. 5.0"
                        value={criteriaMaxValue}
                        onChange={(e) => setCriteriaMaxValue(e.target.value)}
                        className="w-full p-2.5 rounded-xl border border-[#EAE4D5] font-mono text-xs"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Acceptable Option (Qualitative / Sensory)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. NEGATIVE, NORMAL, CLEAN, SWEET"
                    value={criteriaAcceptableOption}
                    onChange={(e) => setCriteriaAcceptableOption(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-[#EAE4D5] font-mono text-xs uppercase"
                  />
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {['NEGATIVE', 'POSITIVE', 'NORMAL', 'CLEAN', 'SWEET', 'PASS', 'OK'].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setCriteriaAcceptableOption(preset)}
                        className="px-2 py-0.5 text-[10px] font-mono font-bold bg-slate-50 border border-slate-300 rounded hover:bg-slate-100"
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="block font-bold text-slate-700 mb-1">Governance Audit Reason</label>
                <input
                  type="text"
                  value={criteriaReason}
                  onChange={(e) => setCriteriaReason(e.target.value)}
                  required
                  className="w-full p-2.5 rounded-xl border border-[#EAE4D5] text-xs"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#EAE4D5]">
                <button
                  type="button"
                  onClick={() => setIsCriteriaModalOpen(false)}
                  className="px-4 py-2 text-xs font-bold rounded-xl border border-[#EAE4D5] bg-[#FDFBF9] hover:bg-[#F4F0E6] text-slate-700 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={criteriaSubmitting}
                  className="px-4 py-2 text-xs font-bold rounded-xl bg-[#1E3A8A] text-white hover:bg-blue-900 transition disabled:opacity-50"
                >
                  {criteriaSubmitting ? 'Saving Criteria...' : 'Save Acceptance Criteria'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
