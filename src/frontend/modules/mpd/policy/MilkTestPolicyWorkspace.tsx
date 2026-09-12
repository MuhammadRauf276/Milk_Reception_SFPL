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
  Truck,
  Store,
  Factory,
} from 'lucide-react';
import {
  CANONICAL_TESTING_POINTS,
  MPD_TESTING_POINTS,
  TestingPoint,
  SerializedPolicyAssignment,
} from '@/types/milk-test-policy';

interface LabTestOption {
  id: string;
  testCode: string;
  testName: string;
  resultType: string;
  unit: string | null;
  displayOrder: number;
  isActive: boolean;
}

interface MilkTestPolicyWorkspaceProps {
  currentUser: User | null;
}

const TESTING_POINT_METADATA: Record<
  TestingPoint,
  { label: string; description: string; icon: React.ComponentType<{ className?: string }> }
> = {
  MOT_SHOP: {
    label: 'MOT Shop Collection',
    description: 'Required & optional tests performed by MOT drivers when collecting milk at village shops.',
    icon: Store,
  },
  ZMCC_LAB_MOT: {
    label: 'ZMCC Lab (MOT Arrivals)',
    description: 'Mandatory tests evaluated by ZMCC Lab Attendants on arriving MOT collection vehicles.',
    icon: Truck,
  },
  ZMCC_LAB_CONTRACTOR: {
    label: 'ZMCC Lab (Contractor Arrivals)',
    description: 'Mandatory tests evaluated by ZMCC Lab Attendants on arriving direct contractor vehicles.',
    icon: Building,
  },
  DISPATCH: {
    label: 'ZMCC Dispatch to Factory',
    description: 'Tests required before tanker departs ZMCC / Contractor source for the processing plant.',
    icon: Factory,
  },
  PLANT_QA: {
    label: 'Plant QA Reception',
    description: 'Reception testing executed by factory QA Chemists before milk unloading into silos.',
    icon: ShieldCheck,
  },
};

export const MilkTestPolicyWorkspace: React.FC<MilkTestPolicyWorkspaceProps> = ({ currentUser }) => {
  const toast = useToast();
  const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';

  const allowedTestingPoints: TestingPoint[] = isSuperAdmin
    ? [...CANONICAL_TESTING_POINTS]
    : [...MPD_TESTING_POINTS];

  const [activeTab, setActiveTab] = useState<TestingPoint>(allowedTestingPoints[0] || 'MOT_SHOP');
  const [policies, setPolicies] = useState<SerializedPolicyAssignment[]>([]);
  const [labTests, setLabTests] = useState<LabTestOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showActiveOnly, setShowActiveOnly] = useState(false);

  // Modal State for adding a test
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedLabTestId, setSelectedLabTestId] = useState('');
  const [modalIsRequired, setModalIsRequired] = useState(true);
  const [modalDisplayOrder, setModalDisplayOrder] = useState<number>(10);
  const [submitting, setSubmitting] = useState(false);

  // Fetch policies for current testing point
  const fetchPolicies = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/milk-test-policies?testingPoint=${activeTab}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to fetch policies');
      }
      const data = await res.json();
      setPolicies(data.policies || []);
    } catch (err: any) {
      toast.showError(err.message || 'Error loading policies');
    } finally {
      setLoading(false);
    }
  }, [activeTab, toast]);

  // Fetch all active lab tests for selection
  const fetchLabTests = useCallback(async () => {
    try {
      const res = await fetch('/api/lab-tests?activeOnly=true');
      if (res.ok) {
        const data = await res.json();
        const tests = Array.isArray(data) ? data : data.tests || [];
        setLabTests(tests.filter((t: any) => t.isActive));
      }
    } catch (err) {
      console.error('Error fetching lab tests catalogue', err);
    }
  }, []);

  useEffect(() => {
    fetchPolicies();
  }, [fetchPolicies]);

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
        `Test "${policy.labTest?.testName || policy.labTestId}" ${newStatus ? 'activated' : 'deactivated'} for ${TESTING_POINT_METADATA[policy.testingPoint].label}.`
      );
    } catch (err: any) {
      toast.showError(err.message || 'Failed to update status');
    }
  };

  const handleToggleRequired = async (policy: SerializedPolicyAssignment) => {
    const newRequired = !policy.isRequired;
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
    } catch (err: any) {
      toast.showError(err.message || 'Failed to update requirement');
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
    } catch (err: any) {
      toast.showError(err.message || 'Failed to update display order');
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
      const res = await fetch('/api/milk-test-policies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          labTestId: selectedLabTestId,
          testingPoint: activeTab,
          isRequired: modalIsRequired,
          displayOrder: modalDisplayOrder,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to assign test policy');
      }

      const created = await res.json();
      setPolicies((prev) =>
        [...prev, created.policy].sort((a, b) => a.displayOrder - b.displayOrder || Number(a.id) - Number(b.id))
      );
      toast.showSuccess(
        `Assigned "${created.policy.labTest?.testName || selectedLabTestId}" to ${TESTING_POINT_METADATA[activeTab].label}.`
      );
      setIsAddModalOpen(false);
      setSelectedLabTestId('');
    } catch (err: any) {
      toast.showError(err.message || 'Failed to add test policy');
    } finally {
      setSubmitting(false);
    }
  };

  // Filter out tests already assigned in current testing point
  const assignedTestIds = new Set(policies.map((p) => p.labTestId));
  const availableLabTests = labTests.filter((t) => !assignedTestIds.has(t.id));

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

  const activeMetadata = TESTING_POINT_METADATA[activeTab];
  const ActiveIcon = activeMetadata.icon;

  return (
    <div className="space-y-6">
      {/* HEADER BANNER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-[#EAE4D5] shadow-xs">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-[#1E3A8A] text-white rounded-xl">
              <FlaskConical className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-black tracking-tight text-[#111311]">
                {isSuperAdmin ? 'Central Milk Test Policy Administration' : 'Milk Procurement Test Policy'}
              </h1>
              <p className="text-xs text-slate-600 font-medium">
                {isSuperAdmin
                  ? 'System-wide policy authority: Configure required & optional tests across all testing stages'
                  : 'Head of MPD Authority: Configure authoritative tests for procurement testing points'}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={fetchPolicies}
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
              setIsAddModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-xl bg-[#1E3A8A] text-white hover:bg-blue-900 transition shadow-xs"
          >
            <Plus className="w-4 h-4" />
            <span>Assign Test</span>
          </button>
        </div>
      </div>

      {/* TESTING POINT TABS */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {allowedTestingPoints.map((point) => {
          const meta = TESTING_POINT_METADATA[point];
          const Icon = meta.icon;
          const isSelected = activeTab === point;
          return (
            <button
              key={point}
              onClick={() => setActiveTab(point)}
              className={`flex flex-col p-3 rounded-xl border text-left transition ${
                isSelected
                  ? 'bg-[#1E3A8A] text-white border-[#1E3A8A] shadow-sm'
                  : 'bg-white text-slate-800 border-[#EAE4D5] hover:bg-[#FDFBF9]'
              }`}
            >
              <div className="flex items-center justify-between w-full mb-1">
                <Icon className={`w-4 h-4 ${isSelected ? 'text-white' : 'text-[#1E3A8A]'}`} />
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-black ${
                    isSelected ? 'bg-blue-800 text-white' : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {point === activeTab ? policies.length : '-'}
                </span>
              </div>
              <span className="text-xs font-black truncate">{meta.label}</span>
              <span
                className={`text-[10px] truncate mt-0.5 ${
                  isSelected ? 'text-blue-100' : 'text-slate-600'
                }`}
              >
                {point}
              </span>
            </button>
          );
        })}
      </div>

      {/* CURRENT TAB DESCRIPTION */}
      <div className="bg-white p-4 rounded-xl border border-[#EAE4D5] flex items-start gap-3">
        <ActiveIcon className="w-5 h-5 text-[#1E3A8A] shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-black text-[#111311]">{activeMetadata.label}</h2>
            <span className="text-[10px] font-mono font-extrabold px-2 py-0.5 rounded bg-blue-50 text-[#1E3A8A] border border-blue-200">
              {activeTab}
            </span>
          </div>
          <p className="text-xs text-slate-600 mt-0.5">{activeMetadata.description}</p>
        </div>
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

      {/* POLICY ASSIGNMENT TABLE */}
      <div className="bg-white rounded-2xl border border-[#EAE4D5] overflow-hidden shadow-xs">
        {loading ? (
          <div className="p-12 text-center text-xs font-bold text-slate-600">
            <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-[#1E3A8A]" />
            Loading test policies...
          </div>
        ) : filteredPolicies.length === 0 ? (
          <div className="p-12 text-center">
            <FlaskConical className="w-8 h-8 mx-auto text-slate-300 mb-2" />
            <h3 className="text-sm font-bold text-slate-700">No Policy Assignments</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              No tests are currently assigned to {activeMetadata.label}. Click "Assign Test" above to configure testing requirements.
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
                  <th className="py-3 px-4">Policy Status</th>
                  <th className="py-3 px-4">Created / Updated By</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EAE4D5]">
                {filteredPolicies.map((policy) => {
                  const isRowActive = policy.isActive;
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

                      {/* Creator / Updater */}
                      <td className="py-3 px-4 text-[10px] text-slate-500 font-mono">
                        <div>
                          By: <span className="font-bold text-slate-700">{policy.creator?.username || policy.createdByUserId}</span>
                        </div>
                        {policy.updater && (
                          <div>
                            Edit: <span className="font-bold text-slate-700">{policy.updater.username}</span>
                          </div>
                        )}
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

      {/* ASSIGN TEST MODAL */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl border border-[#EAE4D5] shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#EAE4D5]">
              <div className="flex items-center gap-2">
                <FlaskConical className="w-5 h-5 text-[#1E3A8A]" />
                <h3 className="font-black text-base text-[#111311]">
                  Assign Test to {activeMetadata.label}
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
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Select Laboratory Test <span className="text-rose-600">*</span>
                </label>
                {availableLabTests.length === 0 ? (
                  <p className="text-xs text-amber-700 bg-amber-50 p-2.5 rounded-lg border border-amber-200 font-medium">
                    All active tests in the master catalogue are already assigned to this testing point.
                  </p>
                ) : (
                  <select
                    value={selectedLabTestId}
                    onChange={(e) => setSelectedLabTestId(e.target.value)}
                    required
                    className="w-full p-2.5 rounded-xl border border-[#EAE4D5] bg-white text-xs font-bold focus:ring-2 focus:ring-[#1E3A8A]"
                  >
                    <option value="">-- Choose a test from catalogue --</option>
                    {availableLabTests.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.testName} ({t.testCode}) — {t.resultType}
                      </option>
                    ))}
                  </select>
                )}
              </div>

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
                  {submitting ? 'Assigning...' : 'Assign to Policy'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
