'use client';

import React, { useEffect, useState } from 'react';
import { Edit2, ShieldAlert, CheckCircle2, Lock, Plus, Trash2, X, AlertTriangle } from 'lucide-react';
import { mapScopeCheckboxes } from '@/lib/validations/labTest';

interface LabTestResultOption {
  value: string;
  label: string;
  isPassing: boolean | null;
}

interface LabTest {
  id: string;
  testCode: string;
  testName: string;
  resultType: string;
  unit: string | null;
  testScope: string;
  isRequired: boolean;
  isActive: boolean;
  displayOrder: number;
  historicalResultsCount: number;
  resultOptions: LabTestResultOption[] | null;
}

interface ConfirmModalState {
  test: LabTest;
  action: 'ACTIVATE' | 'DEACTIVATE';
}

export default function SuperAdminLabTestsPage() {
  const [labTests, setLabTests] = useState<LabTest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Submitting states
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false);
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);
  const [isSubmittingToggle, setIsSubmittingToggle] = useState(false);

  // Modal error states
  const [createModalError, setCreateModalError] = useState<string | null>(null);
  const [editModalError, setEditModalError] = useState<string | null>(null);
  const [confirmModalError, setConfirmModalError] = useState<string | null>(null);

  // Create Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createResultType, setCreateResultType] = useState('QUALITATIVE');
  const [createUnit, setCreateUnit] = useState('');
  const [createScopeDispatch, setCreateScopeDispatch] = useState(true);
  const [createScopePlantQA, setCreateScopePlantQA] = useState(true);
  const [createScopeZmcc, setCreateScopeZmcc] = useState(false);
  const [createDisplayOrder, setCreateDisplayOrder] = useState(10);
  const [createOptions, setCreateOptions] = useState<LabTestResultOption[]>([
    { value: 'PASS', label: 'Pass', isPassing: true },
    { value: 'FAIL', label: 'Fail', isPassing: false },
  ]);

  // Edit modal
  const [showEditModal, setShowEditModal] = useState<LabTest | null>(null);
  const [editName, setEditName] = useState('');
  const [editUnit, setEditUnit] = useState('');
  const [editScopeDispatch, setEditScopeDispatch] = useState(true);
  const [editScopePlantQA, setEditScopePlantQA] = useState(true);
  const [editScopeZmcc, setEditScopeZmcc] = useState(false);
  const [editDisplayOrder, setEditDisplayOrder] = useState(0);
  const [editOptions, setEditOptions] = useState<LabTestResultOption[]>([]);

  // Toggle confirmation modal
  const [showConfirmModal, setShowConfirmModal] = useState<ConfirmModalState | null>(null);

  async function loadLabTests() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/super-admin/lab-tests', { cache: 'no-store' });
      const data = await res.json();
      if (res.ok) setLabTests(data.labTests || []);
      else setError(data.error || 'Failed to load lab tests');
    } catch (err: any) {
      setError(err.message || 'Network error loading lab tests');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLabTests();
  }, []);

  const resetCreateForm = () => {
    setCreateName('');
    setCreateResultType('QUALITATIVE');
    setCreateUnit('');
    setCreateScopeDispatch(true);
    setCreateScopePlantQA(true);
    setCreateScopeZmcc(false);
    setCreateDisplayOrder(labTests.length > 0 ? Math.max(...labTests.map((t) => t.displayOrder)) + 1 : 1);
    setCreateOptions([
      { value: 'PASS', label: 'Pass', isPassing: true },
      { value: 'FAIL', label: 'Fail', isPassing: false },
    ]);
    setCreateModalError(null);
  };

  const closeCreateModal = () => {
    setShowCreateModal(false);
    resetCreateForm();
  };

  const closeEditModal = () => {
    setShowEditModal(null);
    setEditModalError(null);
  };

  const closeConfirmModal = () => {
    setShowConfirmModal(null);
    setConfirmModalError(null);
  };

  // Keyboard accessibility: Escape closes any open modal when not submitting
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!isSubmittingCreate && !isSubmittingEdit && !isSubmittingToggle) {
          if (showConfirmModal) {
            closeConfirmModal();
          } else if (showEditModal) {
            closeEditModal();
          } else if (showCreateModal) {
            closeCreateModal();
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSubmittingCreate, isSubmittingEdit, isSubmittingToggle, showConfirmModal, showEditModal, showCreateModal]);

  const handleCreateTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingCreate) return;
    setCreateModalError(null);
    setError(null);
    setSuccessMsg(null);

    const trimmedName = createName.trim();
    if (!trimmedName) {
      setCreateModalError('Test Name is required.');
      return;
    }

    let testScope: string;
    try {
      testScope = mapScopeCheckboxes(createScopeDispatch, createScopePlantQA, createScopeZmcc);
    } catch (err: any) {
      setCreateModalError(err.message || 'Please select at least one scope (Dispatch, Plant QA, or ZMCC Lab).');
      return;
    }

    const isCategorical = ['QUALITATIVE', 'OK_NOT_OK', 'POSITIVE_NEGATIVE'].includes(createResultType);
    if (isCategorical && createOptions.length < 2) {
      setCreateModalError('Categorical tests must have at least 2 result options.');
      return;
    }

    setIsSubmittingCreate(true);
    try {
      const payload: any = {
        testName: trimmedName,
        resultType: createResultType,
        unit: createUnit ? createUnit.trim() : null,
        testScope,
        displayOrder: Number(createDisplayOrder),
      };

      if (isCategorical) {
        payload.resultOptions = createOptions;
      }

      const res = await fetch('/api/super-admin/lab-tests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create lab test');

      setSuccessMsg(`Lab Test "${data.labTest.testCode}" (${data.labTest.testName}) created successfully.`);
      closeCreateModal();
      loadLabTests();
    } catch (err: any) {
      setCreateModalError(err.message || 'Failed to create lab test');
    } finally {
      setIsSubmittingCreate(false);
    }
  };

  const handleUpdateTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showEditModal || isSubmittingEdit) return;
    setEditModalError(null);
    setError(null);
    setSuccessMsg(null);

    const trimmedName = editName.trim();
    if (!trimmedName) {
      setEditModalError('Test Name is required.');
      return;
    }

    let testScope: string;
    try {
      testScope = mapScopeCheckboxes(editScopeDispatch, editScopePlantQA, editScopeZmcc);
    } catch (err: any) {
      setEditModalError(err.message || 'Please select at least one scope (Dispatch, Plant QA, or ZMCC Lab).');
      return;
    }

    const isCategorical = ['QUALITATIVE', 'OK_NOT_OK', 'POSITIVE_NEGATIVE'].includes(showEditModal.resultType);
    if (isCategorical && editOptions.length < 2) {
      setEditModalError('Categorical tests must have at least 2 result options.');
      return;
    }

    setIsSubmittingEdit(true);
    try {
      const payload: any = {
        testName: trimmedName,
        unit: editUnit ? editUnit.trim() : null,
        testScope,
        displayOrder: Number(editDisplayOrder),
      };

      if (isCategorical) {
        payload.resultOptions = editOptions;
      }

      const res = await fetch(`/api/super-admin/lab-tests/${showEditModal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update lab test');

      setSuccessMsg(`Lab Test "${showEditModal.testCode}" updated successfully.`);
      closeEditModal();
      loadLabTests();
    } catch (err: any) {
      setEditModalError(err.message || 'Failed to update lab test');
    } finally {
      setIsSubmittingEdit(false);
    }
  };

  const handleConfirmToggleActive = async () => {
    if (!showConfirmModal || isSubmittingToggle) return;
    setConfirmModalError(null);
    setError(null);
    setSuccessMsg(null);

    const { test, action } = showConfirmModal;
    const newStatus = action === 'ACTIVATE';

    setIsSubmittingToggle(true);
    try {
      const res = await fetch(`/api/super-admin/lab-tests/${test.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: newStatus }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update test status');

      setSuccessMsg(`Lab Test "${test.testCode}" ${newStatus ? 'activated' : 'deactivated'} successfully.`);
      closeConfirmModal();
      loadLabTests();
    } catch (err: any) {
      setConfirmModalError(err.message || 'Failed to update test status');
    } finally {
      setIsSubmittingToggle(false);
    }
  };

  return (
    <div className="space-y-4 w-full max-w-full overflow-x-hidden">
      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-bold flex items-center space-x-2">
          <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs font-bold flex items-center space-x-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* LAB TESTS TABLE */}
      <div className="bg-white rounded-xl border border-[#EAE4D5]/80 shadow-sm overflow-hidden w-full max-w-full">
        <div className="p-3 sm:px-4 sm:py-3 border-b border-[#EAE4D5] flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <h2 className="text-sm font-bold text-[#111311]">Lab Tests</h2>
            <span className="text-[11px] font-mono px-2 py-0.5 bg-[#FDFBF9] border border-[#EAE4D5] text-slate-600 rounded-full">
              {labTests.length}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              resetCreateForm();
              setShowCreateModal(true);
            }}
            aria-label="Add lab test"
            title="Add lab test"
            className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-[#1E3A8A] text-white hover:bg-blue-900 transition shadow-xs"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-x-auto w-full">
          <table className="w-full text-left text-xs min-w-[700px]">
            <thead className="bg-[#FDFBF9] text-slate-600 border-b border-[#EAE4D5]">
              <tr>
                <th className="p-3 font-bold w-12 text-center">#</th>
                <th className="p-3 font-bold">Test Code</th>
                <th className="p-3 font-bold">Test Name</th>
                <th className="p-3 font-bold">Result Type & Options</th>
                <th className="p-3 font-bold">Unit</th>
                <th className="p-3 font-bold">Scope</th>
                <th className="p-3 font-bold">Historical Results</th>
                <th className="p-3 font-bold">Status</th>
                <th className="p-3 font-bold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EAE4D5]/60 font-medium">
              {loading ? (
                <tr>
                  <td colSpan={9} className="p-6 text-center text-slate-400 font-mono">
                    Loading laboratory test catalog...
                  </td>
                </tr>
              ) : labTests.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-6 text-center text-slate-400">
                    No lab tests found.
                  </td>
                </tr>
              ) : (
                labTests.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="p-3 text-center font-mono font-bold text-slate-400">{t.displayOrder}</td>
                    <td className="p-3 font-mono font-bold text-[#111311]">{t.testCode}</td>
                    <td className="p-3 font-bold text-slate-800">{t.testName}</td>
                    <td className="p-3">
                      <div className="space-y-1">
                        <span
                          className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold flex items-center w-fit space-x-1 ${
                            t.resultType === 'NUMERIC'
                              ? 'bg-blue-100 text-blue-900'
                              : t.resultType === 'POSITIVE_NEGATIVE'
                              ? 'bg-emerald-100 text-emerald-900'
                              : t.resultType === 'OK_NOT_OK'
                              ? 'bg-purple-100 text-purple-900'
                              : t.resultType === 'QUALITATIVE'
                              ? 'bg-indigo-100 text-indigo-900'
                              : 'bg-amber-100 text-amber-900'
                          }`}
                        >
                          <span>{t.resultType}</span>
                          {t.historicalResultsCount > 0 && (
                            <span title="Result type locked due to existing historical results">
                              <Lock className="w-3 h-3 text-slate-500" />
                            </span>
                          )}
                        </span>

                        {Array.isArray(t.resultOptions) && t.resultOptions.length > 0 && (
                          <div className="flex flex-wrap gap-1 pt-0.5">
                            {t.resultOptions.map((opt) => (
                              <span
                                key={opt.value}
                                className={`px-1.5 py-0.2 rounded text-[9px] font-mono font-bold border ${
                                  opt.isPassing === true
                                    ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                    : opt.isPassing === false
                                    ? 'bg-rose-50 text-rose-800 border-rose-300'
                                    : 'bg-slate-50 text-slate-700 border-slate-300'
                                }`}
                              >
                                {opt.label || opt.value}{' '}
                                {opt.isPassing === true ? '(Pass)' : opt.isPassing === false ? '(Fail)' : '(Neutral)'}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="p-3 font-mono text-slate-600">{t.unit || '-'}</td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {(t.testScope === 'DISPATCH' || t.testScope === 'BOTH' || t.testScope === 'ALL') && (
                          <span className="px-2 py-0.5 rounded bg-sky-100 text-sky-800 text-[10px] font-bold font-mono">
                            Dispatch
                          </span>
                        )}
                        {(t.testScope === 'PLANT' || t.testScope === 'BOTH' || t.testScope === 'ALL') && (
                          <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold font-mono">
                            Plant QA
                          </span>
                        )}
                        {(t.testScope === 'ZMCC' || t.testScope === 'ALL') && (
                          <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold font-mono">
                            ZMCC Lab
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-3 font-mono font-bold text-slate-700">{t.historicalResultsCount} records</td>
                    <td className="p-3">
                      {t.isActive ? (
                        <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                          Active
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 text-[10px] font-bold">
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-right space-x-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditModalError(null);
                          setShowEditModal(t);
                          setEditName(t.testName);
                          setEditUnit(t.unit || '');
                          setEditScopeDispatch(t.testScope === 'DISPATCH' || t.testScope === 'BOTH' || t.testScope === 'ALL');
                          setEditScopePlantQA(t.testScope === 'PLANT' || t.testScope === 'BOTH' || t.testScope === 'ALL');
                          setEditScopeZmcc(t.testScope === 'ZMCC' || t.testScope === 'ALL');
                          setEditDisplayOrder(t.displayOrder);
                          setEditOptions(t.resultOptions ? JSON.parse(JSON.stringify(t.resultOptions)) : []);
                        }}
                        className="px-2.5 py-1.5 min-h-[44px] inline-flex items-center justify-center bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-bold transition"
                      >
                        <Edit2 className="w-3.5 h-3.5 mr-1" />
                        Edit Metadata
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmModalError(null);
                          setShowConfirmModal({
                            test: t,
                            action: t.isActive ? 'DEACTIVATE' : 'ACTIVATE',
                          });
                        }}
                        className={`px-2.5 py-1.5 min-h-[44px] inline-flex items-center justify-center rounded-lg text-[11px] font-bold transition ${
                          t.isActive
                            ? 'bg-rose-50 hover:bg-rose-100 text-rose-700'
                            : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700'
                        }`}
                      >
                        {t.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* CREATE LAB TEST MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-[#EAE4D5] p-6 w-full max-w-lg space-y-4 shadow-xl my-8">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-extrabold text-[#111311]">Create New Laboratory Test</h3>
              <button
                type="button"
                onClick={closeCreateModal}
                disabled={isSubmittingCreate}
                aria-label="Close dialog"
                className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition disabled:opacity-50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {createModalError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-bold flex items-center space-x-2">
                <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{createModalError}</span>
              </div>
            )}

            <form onSubmit={handleCreateTest} className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Test Name *</label>
                <input
                  type="text"
                  required
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="e.g. Alcohol Stability Test"
                  className="w-full p-2.5 rounded-lg border border-[#C4B9A3] focus:outline-none focus:border-[#1E3A8A]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Result Type *</label>
                  <select
                    value={createResultType}
                    onChange={(e) => {
                      const newType = e.target.value;
                      setCreateResultType(newType);
                      if (['QUALITATIVE', 'OK_NOT_OK', 'POSITIVE_NEGATIVE'].includes(newType) && createOptions.length === 0) {
                        setCreateOptions([
                          { value: 'PASS', label: 'Pass', isPassing: true },
                          { value: 'FAIL', label: 'Fail', isPassing: false },
                        ]);
                      }
                    }}
                    className="w-full p-2.5 rounded-lg border border-[#C4B9A3] focus:outline-none focus:border-[#1E3A8A]"
                  >
                    <option value="QUALITATIVE">QUALITATIVE (Configurable Choices)</option>
                    <option value="NUMERIC">NUMERIC (Decimal / Float)</option>
                    <option value="TEXT">TEXT (Free text)</option>
                    <option value="OK_NOT_OK">OK_NOT_OK</option>
                    <option value="POSITIVE_NEGATIVE">POSITIVE_NEGATIVE</option>
                    <option value="CALCULATED">CALCULATED (SNF / Ratio)</option>
                  </select>
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">Unit</label>
                  <input
                    type="text"
                    value={createUnit}
                    onChange={(e) => setCreateUnit(e.target.value)}
                    className="w-full p-2.5 rounded-lg border border-[#C4B9A3] focus:outline-none focus:border-[#1E3A8A]"
                    placeholder="e.g. % or °C (optional)"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 items-center">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Scope *</label>
                  <div className="flex items-center gap-4 pt-1">
                    <label className="flex items-center space-x-2 cursor-pointer select-none text-xs font-medium text-slate-800 min-h-[44px]">
                      <input
                        type="checkbox"
                        checked={createScopeDispatch}
                        onChange={(e) => setCreateScopeDispatch(e.target.checked)}
                        className="w-4 h-4 text-[#1E3A8A] rounded border-slate-300 focus:ring-[#1E3A8A]"
                      />
                      <span>Dispatch</span>
                    </label>
                    <label className="flex items-center space-x-2 cursor-pointer select-none text-xs font-medium text-slate-800 min-h-[44px]">
                      <input
                        type="checkbox"
                        checked={createScopePlantQA}
                        onChange={(e) => setCreateScopePlantQA(e.target.checked)}
                        className="w-4 h-4 text-[#1E3A8A] rounded border-slate-300 focus:ring-[#1E3A8A]"
                      />
                      <span>Plant QA</span>
                    </label>
                    <label className="flex items-center space-x-2 cursor-pointer select-none text-xs font-medium text-slate-800 min-h-[44px]">
                      <input
                        type="checkbox"
                        checked={createScopeZmcc}
                        onChange={(e) => setCreateScopeZmcc(e.target.checked)}
                        className="w-4 h-4 text-[#1E3A8A] rounded border-slate-300 focus:ring-[#1E3A8A]"
                      />
                      <span>ZMCC Lab</span>
                    </label>
                  </div>
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">Display Order *</label>
                  <input
                    type="number"
                    required
                    value={createDisplayOrder}
                    onChange={(e) => setCreateDisplayOrder(Number(e.target.value))}
                    className="w-full p-2.5 rounded-lg border border-[#C4B9A3] font-mono focus:outline-none focus:border-[#1E3A8A]"
                  />
                </div>
              </div>

              {/* OPTION CONFIGURATOR FOR CATEGORICAL TESTS */}
              {['QUALITATIVE', 'OK_NOT_OK', 'POSITIVE_NEGATIVE'].includes(createResultType) && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="font-bold text-slate-800 text-xs">
                      Qualitative Result Options (Min. 2 required)
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setCreateOptions([
                          ...createOptions,
                          {
                            value: `OPT_${createOptions.length + 1}`,
                            label: `Option ${createOptions.length + 1}`,
                            isPassing: true,
                          },
                        ]);
                      }}
                      className="text-[11px] font-bold text-blue-700 hover:text-blue-900 flex items-center space-x-1 p-1 min-h-[44px]"
                    >
                      <Plus className="w-3.5 h-3.5 mr-0.5" />
                      <span>Add Choice</span>
                    </button>
                  </div>

                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {createOptions.map((opt, idx) => (
                      <div key={idx} className="flex items-center gap-1.5 bg-white p-2 rounded-lg border border-slate-200">
                        <input
                          type="text"
                          required
                          placeholder="Stored Value (e.g. OK)"
                          value={opt.value}
                          onChange={(e) => {
                            const updated = [...createOptions];
                            updated[idx].value = e.target.value;
                            setCreateOptions(updated);
                          }}
                          className="w-1/3 p-1.5 text-[11px] font-mono rounded border border-slate-300"
                        />
                        <input
                          type="text"
                          required
                          placeholder="Display Label"
                          value={opt.label}
                          onChange={(e) => {
                            const updated = [...createOptions];
                            updated[idx].label = e.target.value;
                            setCreateOptions(updated);
                          }}
                          className="w-1/3 p-1.5 text-[11px] rounded border border-slate-300"
                        />
                        <select
                          value={opt.isPassing === true ? 'PASS' : opt.isPassing === false ? 'FAIL' : 'NEUTRAL'}
                          onChange={(e) => {
                            const updated = [...createOptions];
                            const val = e.target.value;
                            updated[idx].isPassing = val === 'PASS' ? true : val === 'FAIL' ? false : null;
                            setCreateOptions(updated);
                          }}
                          className="w-1/4 p-1.5 text-[11px] font-bold rounded border border-slate-300"
                        >
                          <option value="PASS">Pass</option>
                          <option value="FAIL">Fail</option>
                          <option value="NEUTRAL">Neutral / Info</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            setCreateOptions(createOptions.filter((_, i) => i !== idx));
                          }}
                          disabled={createOptions.length <= 2}
                          className="p-1 min-h-[44px] min-w-[32px] flex items-center justify-center text-rose-600 hover:text-rose-800 disabled:opacity-30"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-[#EAE4D5]">
                <button
                  type="button"
                  onClick={closeCreateModal}
                  disabled={isSubmittingCreate}
                  className="px-4 py-2 min-h-[44px] rounded-xl border border-slate-300 text-slate-700 font-bold hover:bg-slate-50 transition disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingCreate}
                  className="px-5 py-2 min-h-[44px] rounded-xl bg-[#1E3A8A] text-white font-bold hover:bg-blue-900 transition shadow-sm disabled:opacity-50"
                >
                  {isSubmittingCreate ? 'Creating...' : 'Create Lab Test'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT LAB TEST METADATA MODAL */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-[#EAE4D5] p-6 w-full max-w-lg space-y-4 shadow-xl my-8">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-extrabold text-[#111311]">
                Edit Test Metadata ({showEditModal.testCode})
              </h3>
              <button
                type="button"
                onClick={closeEditModal}
                disabled={isSubmittingEdit}
                aria-label="Close dialog"
                className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition disabled:opacity-50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 text-[11px] font-medium space-y-1">
              <div>
                Result Type: <strong className="font-mono">{showEditModal.resultType}</strong> (Protected)
              </div>
              <div>
                Historical Records: <strong>{showEditModal.historicalResultsCount}</strong>
              </div>
            </div>

            {editModalError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-bold flex items-center space-x-2">
                <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{editModalError}</span>
              </div>
            )}

            <form onSubmit={handleUpdateTest} className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Test Name *</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-[#C4B9A3] focus:outline-none focus:border-[#1E3A8A]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Unit</label>
                  <input
                    type="text"
                    value={editUnit}
                    onChange={(e) => setEditUnit(e.target.value)}
                    className="w-full p-2.5 rounded-lg border border-[#C4B9A3] focus:outline-none focus:border-[#1E3A8A]"
                    placeholder="e.g. °C or % or leave blank"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">Display Order *</label>
                  <input
                    type="number"
                    required
                    value={editDisplayOrder}
                    onChange={(e) => setEditDisplayOrder(Number(e.target.value))}
                    className="w-full p-2.5 rounded-lg border border-[#C4B9A3] font-mono focus:outline-none focus:border-[#1E3A8A]"
                  />
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Scope *</label>
                <div className="flex items-center gap-4 pt-1">
                  <label className="flex items-center space-x-2 cursor-pointer select-none text-xs font-medium text-slate-800 min-h-[44px]">
                    <input
                      type="checkbox"
                      checked={editScopeDispatch}
                      onChange={(e) => setEditScopeDispatch(e.target.checked)}
                      className="w-4 h-4 text-[#1E3A8A] rounded border-slate-300 focus:ring-[#1E3A8A]"
                    />
                    <span>Dispatch</span>
                  </label>
                  <label className="flex items-center space-x-2 cursor-pointer select-none text-xs font-medium text-slate-800 min-h-[44px]">
                    <input
                      type="checkbox"
                      checked={editScopePlantQA}
                      onChange={(e) => setEditScopePlantQA(e.target.checked)}
                      className="w-4 h-4 text-[#1E3A8A] rounded border-slate-300 focus:ring-[#1E3A8A]"
                    />
                    <span>Plant QA</span>
                  </label>
                  <label className="flex items-center space-x-2 cursor-pointer select-none text-xs font-medium text-slate-800 min-h-[44px]">
                    <input
                      type="checkbox"
                      checked={editScopeZmcc}
                      onChange={(e) => setEditScopeZmcc(e.target.checked)}
                      className="w-4 h-4 text-[#1E3A8A] rounded border-slate-300 focus:ring-[#1E3A8A]"
                    />
                    <span>ZMCC Lab</span>
                  </label>
                </div>
              </div>

              {/* EDIT OPTIONS FOR CATEGORICAL TESTS */}
              {['QUALITATIVE', 'OK_NOT_OK', 'POSITIVE_NEGATIVE'].includes(showEditModal.resultType) && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="font-bold text-slate-800 text-xs">Qualitative Result Options</label>
                    <button
                      type="button"
                      onClick={() => {
                        setEditOptions([
                          ...editOptions,
                          {
                            value: `OPT_${editOptions.length + 1}`,
                            label: `Option ${editOptions.length + 1}`,
                            isPassing: true,
                          },
                        ]);
                      }}
                      className="text-[11px] font-bold text-blue-700 hover:text-blue-900 flex items-center space-x-1 p-1 min-h-[44px]"
                    >
                      <Plus className="w-3.5 h-3.5 mr-0.5" />
                      <span>Add Choice</span>
                    </button>
                  </div>

                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {editOptions.map((opt, idx) => (
                      <div key={idx} className="flex items-center gap-1.5 bg-white p-2 rounded-lg border border-slate-200">
                        <input
                          type="text"
                          required
                          placeholder="Stored Value"
                          value={opt.value}
                          onChange={(e) => {
                            const updated = [...editOptions];
                            updated[idx].value = e.target.value;
                            setEditOptions(updated);
                          }}
                          className="w-1/3 p-1.5 text-[11px] font-mono rounded border border-slate-300"
                        />
                        <input
                          type="text"
                          required
                          placeholder="Display Label"
                          value={opt.label}
                          onChange={(e) => {
                            const updated = [...editOptions];
                            updated[idx].label = e.target.value;
                            setEditOptions(updated);
                          }}
                          className="w-1/3 p-1.5 text-[11px] rounded border border-slate-300"
                        />
                        <select
                          value={opt.isPassing === true ? 'PASS' : opt.isPassing === false ? 'FAIL' : 'NEUTRAL'}
                          onChange={(e) => {
                            const updated = [...editOptions];
                            const val = e.target.value;
                            updated[idx].isPassing = val === 'PASS' ? true : val === 'FAIL' ? false : null;
                            setEditOptions(updated);
                          }}
                          className="w-1/4 p-1.5 text-[11px] font-bold rounded border border-slate-300"
                        >
                          <option value="PASS">Pass</option>
                          <option value="FAIL">Fail</option>
                          <option value="NEUTRAL">Neutral / Info</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            setEditOptions(editOptions.filter((_, i) => i !== idx));
                          }}
                          disabled={editOptions.length <= 2}
                          className="p-1 min-h-[44px] min-w-[32px] flex items-center justify-center text-rose-600 hover:text-rose-800 disabled:opacity-30"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-[#EAE4D5]">
                <button
                  type="button"
                  onClick={closeEditModal}
                  disabled={isSubmittingEdit}
                  className="px-4 py-2 min-h-[44px] rounded-xl border border-slate-300 text-slate-700 font-bold hover:bg-slate-50 transition disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingEdit}
                  className="px-5 py-2 min-h-[44px] rounded-xl bg-[#1E3A8A] text-white font-bold hover:bg-blue-900 transition shadow-sm disabled:opacity-50"
                >
                  {isSubmittingEdit ? 'Updating...' : 'Update Metadata'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ACTIVATION / DEACTIVATION CONFIRMATION MODAL */}
      {showConfirmModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-[#EAE4D5] p-6 w-full max-w-md space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <AlertTriangle
                  className={`w-5 h-5 shrink-0 ${
                    showConfirmModal.action === 'DEACTIVATE' ? 'text-amber-600' : 'text-emerald-600'
                  }`}
                />
                <h3 className="text-base font-extrabold text-[#111311]">
                  {showConfirmModal.action === 'DEACTIVATE' ? 'Deactivate Lab Test' : 'Activate Lab Test'}
                </h3>
              </div>
              <button
                type="button"
                onClick={closeConfirmModal}
                disabled={isSubmittingToggle}
                aria-label="Close dialog"
                className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition disabled:opacity-50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1 text-xs">
              <div>
                <span className="text-slate-500 font-medium">Test Code:</span>{' '}
                <strong className="font-mono text-slate-900">{showConfirmModal.test.testCode}</strong>
              </div>
              <div>
                <span className="text-slate-500 font-medium">Test Name:</span>{' '}
                <strong className="text-slate-900">{showConfirmModal.test.testName}</strong>
              </div>
            </div>

            <div className="text-xs text-slate-600 leading-relaxed">
              {showConfirmModal.action === 'DEACTIVATE' ? (
                <p>
                  Deactivating this test will remove it from newly started sessions. Existing in-progress and
                  historical assignments remain unchanged.
                </p>
              ) : (
                <p>
                  Activating this test will include it in newly started sessions for its selected scope. Existing
                  in-progress assignments remain unchanged.
                </p>
              )}
            </div>

            {confirmModalError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-bold flex items-center space-x-2">
                <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{confirmModalError}</span>
              </div>
            )}

            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-[#EAE4D5]">
              <button
                type="button"
                onClick={closeConfirmModal}
                disabled={isSubmittingToggle}
                className="px-4 py-2 min-h-[44px] rounded-xl border border-slate-300 text-slate-700 font-bold hover:bg-slate-50 transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmToggleActive}
                disabled={isSubmittingToggle}
                className={`px-5 py-2 min-h-[44px] rounded-xl font-bold text-white transition shadow-sm disabled:opacity-50 ${
                  showConfirmModal.action === 'DEACTIVATE'
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                {isSubmittingToggle
                  ? 'Updating...'
                  : showConfirmModal.action === 'DEACTIVATE'
                  ? 'Confirm Deactivation'
                  : 'Confirm Activation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

