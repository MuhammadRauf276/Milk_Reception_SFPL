'use client';

import React, { useEffect, useState } from 'react';
import { FlaskConical, Edit2, ShieldAlert, CheckCircle2, Lock } from 'lucide-react';

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
}

export default function SuperAdminLabTestsPage() {
  const [labTests, setLabTests] = useState<LabTest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Edit modal
  const [showEditModal, setShowEditModal] = useState<LabTest | null>(null);
  const [editName, setEditName] = useState('');
  const [editUnit, setEditUnit] = useState('');
  const [editScope, setEditScope] = useState('BOTH');
  const [editDisplayOrder, setEditDisplayOrder] = useState(0);

  async function loadLabTests() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/super-admin/lab-tests');
      const data = await res.json();
      if (res.ok) setLabTests(data.labTests || []);
      else setError(data.error);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLabTests();
  }, []);

  const handleUpdateTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showEditModal) return;
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await fetch(`/api/super-admin/lab-tests/${showEditModal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          testName: editName,
          unit: editUnit,
          testScope: editScope,
          displayOrder: editDisplayOrder,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update lab test');

      setSuccessMsg(`Lab Test "${showEditModal.testCode}" updated successfully.`);
      setShowEditModal(null);
      loadLabTests();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleToggleActive = async (test: LabTest) => {
    setError(null);
    setSuccessMsg(null);
    const newStatus = !test.isActive;

    try {
      const res = await fetch(`/api/super-admin/lab-tests/${test.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: newStatus }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update status');

      setSuccessMsg(`Lab Test "${test.testCode}" ${newStatus ? 'activated' : 'deactivated'} successfully.`);
      loadLabTests();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-[#111311]">Laboratory Test Master Catalog</h1>
          <p className="text-xs font-medium text-slate-500 mt-1">
            Master catalog of 30 standard laboratory tests with resultType immutability protection for historical records.
          </p>
        </div>
      </div>

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
      <div className="bg-white rounded-xl border border-[#EAE4D5]/80 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#FDFBF9] text-slate-600 border-b border-[#EAE4D5]">
              <tr>
                <th className="p-3 font-bold w-12 text-center">#</th>
                <th className="p-3 font-bold">Test Code</th>
                <th className="p-3 font-bold">Test Name</th>
                <th className="p-3 font-bold">Result Type</th>
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
              ) : (
                labTests.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="p-3 text-center font-mono font-bold text-slate-400">{t.displayOrder}</td>
                    <td className="p-3 font-mono font-bold text-[#111311]">{t.testCode}</td>
                    <td className="p-3 font-bold text-slate-800">{t.testName}</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold flex items-center w-fit space-x-1 ${
                        t.resultType === 'NUMERIC'
                          ? 'bg-blue-100 text-blue-900'
                          : t.resultType === 'POSITIVE_NEGATIVE'
                          ? 'bg-emerald-100 text-emerald-900'
                          : t.resultType === 'OK_NOT_OK'
                          ? 'bg-purple-100 text-purple-900'
                          : 'bg-amber-100 text-amber-900'
                      }`}>
                        <span>{t.resultType}</span>
                        {t.historicalResultsCount > 0 && (
                          <span title="Result type locked due to existing historical results">
                            <Lock className="w-3 h-3 text-slate-500" />
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="p-3 font-mono text-slate-600">{t.unit || '-'}</td>
                    <td className="p-3 font-mono text-slate-600">{t.testScope}</td>
                    <td className="p-3 font-mono font-bold text-slate-700">
                      {t.historicalResultsCount} records
                    </td>
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
                        onClick={() => {
                          setShowEditModal(t);
                          setEditName(t.testName);
                          setEditUnit(t.unit || '');
                          setEditScope(t.testScope);
                          setEditDisplayOrder(t.displayOrder);
                        }}
                        className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[11px] font-bold transition"
                      >
                        <Edit2 className="w-3.5 h-3.5 inline mr-1" />
                        Edit Metadata
                      </button>
                      <button
                        onClick={() => handleToggleActive(t)}
                        className={`px-2 py-1 rounded text-[11px] font-bold transition ${
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

      {/* EDIT LAB TEST METADATA MODAL */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl border border-[#EAE4D5] p-6 w-full max-w-md space-y-4 shadow-xl">
            <h3 className="text-base font-extrabold text-[#111311]">
              Edit Test Metadata ({showEditModal.testCode})
            </h3>
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 text-[11px] font-medium space-y-1">
              <div>Result Type: <strong className="font-mono">{showEditModal.resultType}</strong> (Protected)</div>
              <div>Historical Records: <strong>{showEditModal.historicalResultsCount}</strong></div>
            </div>

            <form onSubmit={handleUpdateTest} className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Test Name *</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full p-2 rounded-lg border border-[#C4B9A3] focus:outline-none focus:border-[#1E3A8A]"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Unit</label>
                <input
                  type="text"
                  value={editUnit}
                  onChange={(e) => setEditUnit(e.target.value)}
                  className="w-full p-2 rounded-lg border border-[#C4B9A3] focus:outline-none focus:border-[#1E3A8A]"
                  placeholder="e.g. °C or % or leave blank"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Test Scope</label>
                <select
                  value={editScope}
                  onChange={(e) => setEditScope(e.target.value)}
                  className="w-full p-2 rounded-lg border border-[#C4B9A3] focus:outline-none focus:border-[#1E3A8A]"
                >
                  <option value="DISPATCH">DISPATCH (MPD Dispatch Only)</option>
                  <option value="PLANT">PLANT (Plant QA Only)</option>
                  <option value="BOTH">BOTH (Dispatch and Plant QA)</option>
                </select>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Display Order</label>
                <input
                  type="number"
                  required
                  value={editDisplayOrder}
                  onChange={(e) => setEditDisplayOrder(Number(e.target.value))}
                  className="w-full p-2 rounded-lg border border-[#C4B9A3] font-mono focus:outline-none focus:border-[#1E3A8A]"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-[#EAE4D5]">
                <button
                  type="button"
                  onClick={() => setShowEditModal(null)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-[#1E3A8A] text-white font-bold hover:bg-blue-900"
                >
                  Update Metadata
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
