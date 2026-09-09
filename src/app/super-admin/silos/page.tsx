'use client';

import React, { useEffect, useState } from 'react';
import { Plus, ShieldAlert, CheckCircle2, Edit2, AlertTriangle, X } from 'lucide-react';

interface Silo {
  id: string;
  siloCode: string;
  siloName: string;
  capacityLiters: number;
  currentStockLiters: number;
  activeReservationsLiters: number;
  isActive: boolean;
  createdAt: string;
}

export default function SuperAdminSilosPage() {
  const [silos, setSilos] = useState<Silo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState<Silo | null>(null);
  const [deactivatingSilo, setDeactivatingSilo] = useState<Silo | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Create form states
  const [siloCode, setSiloCode] = useState('');
  const [siloName, setSiloName] = useState('');
  const [capacityLiters, setCapacityLiters] = useState<number | string>(100000);

  // Edit form states
  const [editName, setEditName] = useState('');
  const [editCapacity, setEditCapacity] = useState<number | string>(0);

  // Close modals on Escape key when not submitting
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        closeModals();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSubmitting]);

  function closeModals() {
    setShowCreateModal(false);
    setShowEditModal(null);
    setDeactivatingSilo(null);
    setModalError(null);
  }

  async function loadSilos() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/super-admin/silos');
      const data = await res.json();
      if (res.ok) setSilos(data.silos || []);
      else setError(data.error);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSilos();
  }, []);

  const handleCreateSilo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    setError(null);
    setModalError(null);
    setSuccessMsg(null);

    const capNum = Number(capacityLiters);
    if (!siloCode.trim()) {
      setModalError('Silo Code is required.');
      return;
    }
    if (!siloName.trim()) {
      setModalError('Silo Name is required.');
      return;
    }
    if (isNaN(capNum) || capNum <= 0) {
      setModalError('Capacity must be a positive number greater than 0 Liters.');
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await fetch('/api/super-admin/silos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siloCode: siloCode.trim().toUpperCase(),
          siloName: siloName.trim(),
          capacityLiters: capNum,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create silo');

      setSuccessMsg(`Silo "${data.silo?.siloCode || siloCode}" created successfully.`);
      setShowCreateModal(false);
      setSiloCode('');
      setSiloName('');
      setCapacityLiters(100000);
      loadSilos();
    } catch (err: any) {
      setModalError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateSilo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showEditModal || isSubmitting) return;

    setError(null);
    setModalError(null);
    setSuccessMsg(null);

    const capNum = Number(editCapacity);
    if (!editName.trim()) {
      setModalError('Silo Name is required.');
      return;
    }
    if (isNaN(capNum) || capNum <= 0) {
      setModalError('Capacity must be a positive number greater than 0 Liters.');
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await fetch(`/api/super-admin/silos/${showEditModal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siloName: editName.trim(),
          capacityLiters: capNum,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update silo');

      setSuccessMsg(`Silo "${showEditModal.siloCode}" updated successfully.`);
      setShowEditModal(null);
      loadSilos();
    } catch (err: any) {
      setModalError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmDeactivate = async () => {
    if (!deactivatingSilo || isSubmitting) return;

    setError(null);
    setModalError(null);
    setSuccessMsg(null);

    try {
      setIsSubmitting(true);
      const res = await fetch(`/api/super-admin/silos/${deactivatingSilo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: false }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to deactivate silo');

      setSuccessMsg(`Silo "${deactivatingSilo.siloCode}" deactivated successfully.`);
      setDeactivatingSilo(null);
      loadSilos();
    } catch (err: any) {
      setModalError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleActivate = async (silo: Silo) => {
    if (isSubmitting) return;
    setError(null);
    setSuccessMsg(null);

    try {
      setIsSubmitting(true);
      const res = await fetch(`/api/super-admin/silos/${silo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: true }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to activate silo');

      setSuccessMsg(`Silo "${silo.siloCode}" reactivated successfully.`);
      loadSilos();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 w-full max-w-full overflow-x-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-[#111311]">Silo Storage</h1>
          <p className="text-xs font-medium text-slate-500 mt-1">
            Plant silo capacity and active status. Stock is ledger-derived from recorded receipts and issues.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setModalError(null);
            setShowCreateModal(true);
          }}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center space-x-2 px-4 py-2.5 bg-[#1E3A8A] text-white rounded-xl text-xs font-bold shadow-sm hover:bg-blue-900 transition shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Add Silo</span>
        </button>
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

      {/* SILOS TABLE */}
      <div className="bg-white rounded-xl border border-[#EAE4D5]/80 shadow-sm overflow-hidden w-full max-w-full">
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left text-xs min-w-[650px]">
            <thead className="bg-[#FDFBF9] text-slate-600 border-b border-[#EAE4D5]">
              <tr>
                <th className="p-3 font-bold">Code</th>
                <th className="p-3 font-bold">Name</th>
                <th className="p-3 font-bold">Total Capacity</th>
                <th className="p-3 font-bold">Current Stock</th>
                <th className="p-3 font-bold">Active Reservations</th>
                <th className="p-3 font-bold">Status</th>
                <th className="p-3 font-bold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EAE4D5]/60 font-medium">
              {loading ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-slate-400 font-mono">
                    Loading silo storage records...
                  </td>
                </tr>
              ) : silos.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-slate-400">
                    No silos configured.
                  </td>
                </tr>
              ) : (
                silos.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="p-3 font-mono font-bold text-[#111311]">{s.siloCode}</td>
                    <td className="p-3 font-bold text-slate-800">{s.siloName}</td>
                    <td className="p-3 font-mono font-bold text-blue-900">
                      {s.capacityLiters.toLocaleString()} L
                    </td>
                    <td className="p-3 font-mono text-emerald-800 font-bold">
                      {s.currentStockLiters.toLocaleString()} L
                    </td>
                    <td className="p-3 font-mono text-amber-800 font-semibold">
                      {s.activeReservationsLiters.toLocaleString()} L
                    </td>
                    <td className="p-3">
                      {s.isActive ? (
                        <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                          Active
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 text-[10px] font-bold">
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end space-x-2">
                        <button
                          type="button"
                          onClick={() => {
                            setModalError(null);
                            setShowEditModal(s);
                            setEditName(s.siloName);
                            setEditCapacity(s.capacityLiters);
                          }}
                          className="min-h-[44px] px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-bold transition flex items-center space-x-1.5"
                          title="Edit Silo Capacity"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                          <span>Edit</span>
                        </button>
                        {s.isActive ? (
                          <button
                            type="button"
                            onClick={() => {
                              setModalError(null);
                              setDeactivatingSilo(s);
                            }}
                            className="min-h-[44px] px-3 py-2 rounded-lg text-[11px] font-bold transition bg-rose-50 hover:bg-rose-100 text-rose-700"
                            title="Deactivate Silo"
                          >
                            Deactivate
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleActivate(s)}
                            disabled={isSubmitting}
                            className="min-h-[44px] px-3 py-2 rounded-lg text-[11px] font-bold transition bg-emerald-50 hover:bg-emerald-100 text-emerald-700"
                            title="Reactivate Silo"
                          >
                            Activate
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* CREATE SILO MODAL */}
      {showCreateModal && (
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50"
          role="dialog"
          aria-modal="true"
          aria-label="Add Silo Storage"
        >
          <div className="bg-white rounded-2xl border border-[#EAE4D5] p-6 w-full max-w-md space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-[#EAE4D5] pb-3">
              <h3 className="text-base font-extrabold text-[#111311]">Add Silo Storage</h3>
              <button
                type="button"
                onClick={closeModals}
                className="p-2 min-h-[44px] min-w-[44px] rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center"
                aria-label="Close dialog"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {modalError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-bold flex items-center space-x-2">
                <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{modalError}</span>
              </div>
            )}

            <form onSubmit={handleCreateSilo} className="space-y-3.5 text-xs">
              <div>
                <label htmlFor="create-silo-code" className="font-bold text-slate-700 block mb-1">
                  Silo Code <span className="text-rose-600">*</span>
                </label>
                <input
                  id="create-silo-code"
                  type="text"
                  required
                  value={siloCode}
                  onChange={(e) => setSiloCode(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-[#C4B9A3] uppercase font-mono focus:outline-none focus:border-[#1E3A8A]"
                  placeholder="e.g. SILO-05"
                  disabled={isSubmitting}
                />
              </div>

              <div>
                <label htmlFor="create-silo-name" className="font-bold text-slate-700 block mb-1">
                  Silo Name <span className="text-rose-600">*</span>
                </label>
                <input
                  id="create-silo-name"
                  type="text"
                  required
                  value={siloName}
                  onChange={(e) => setSiloName(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-[#C4B9A3] focus:outline-none focus:border-[#1E3A8A]"
                  placeholder="e.g. Storage Silo Tank 05"
                  disabled={isSubmitting}
                />
              </div>

              <div>
                <label htmlFor="create-silo-capacity" className="font-bold text-slate-700 block mb-1">
                  Total Capacity (Liters) <span className="text-rose-600">*</span>
                </label>
                <input
                  id="create-silo-capacity"
                  type="number"
                  required
                  min={1}
                  value={capacityLiters}
                  onChange={(e) => setCapacityLiters(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-[#C4B9A3] font-mono focus:outline-none focus:border-[#1E3A8A]"
                  disabled={isSubmitting}
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-[#EAE4D5]">
                <button
                  type="button"
                  onClick={closeModals}
                  disabled={isSubmitting}
                  className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-300 text-slate-700 font-bold hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="min-h-[44px] px-5 py-2 rounded-xl bg-[#1E3A8A] text-white font-bold hover:bg-blue-900 transition shadow-sm disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving...' : 'Save Silo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT SILO MODAL */}
      {showEditModal && (
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50"
          role="dialog"
          aria-modal="true"
          aria-label="Edit Silo Capacity"
        >
          <div className="bg-white rounded-2xl border border-[#EAE4D5] p-6 w-full max-w-md space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-[#EAE4D5] pb-3">
              <h3 className="text-base font-extrabold text-[#111311]">
                Edit Silo ({showEditModal.siloCode})
              </h3>
              <button
                type="button"
                onClick={closeModals}
                className="p-2 min-h-[44px] min-w-[44px] rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center"
                aria-label="Close dialog"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-blue-950 text-xs font-medium space-y-1">
              <div className="flex justify-between">
                <span>Current Stock:</span>
                <strong>{showEditModal.currentStockLiters.toLocaleString()} L</strong>
              </div>
              <div className="flex justify-between">
                <span>Active Reservations:</span>
                <strong>{showEditModal.activeReservationsLiters.toLocaleString()} L</strong>
              </div>
              <div className="flex justify-between border-t border-blue-200/60 pt-1">
                <span>Minimum Allowed Capacity:</span>
                <strong className="text-blue-900">
                  {(showEditModal.currentStockLiters + showEditModal.activeReservationsLiters).toLocaleString()} L
                </strong>
              </div>
            </div>

            {modalError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-bold flex items-center space-x-2">
                <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{modalError}</span>
              </div>
            )}

            <form onSubmit={handleUpdateSilo} className="space-y-3.5 text-xs">
              <div>
                <label htmlFor="edit-silo-name" className="font-bold text-slate-700 block mb-1">
                  Silo Name <span className="text-rose-600">*</span>
                </label>
                <input
                  id="edit-silo-name"
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-[#C4B9A3] focus:outline-none focus:border-[#1E3A8A]"
                  disabled={isSubmitting}
                />
              </div>

              <div>
                <label htmlFor="edit-silo-capacity" className="font-bold text-slate-700 block mb-1">
                  Capacity (Liters) <span className="text-rose-600">*</span>
                </label>
                <input
                  id="edit-silo-capacity"
                  type="number"
                  required
                  min={1}
                  value={editCapacity}
                  onChange={(e) => setEditCapacity(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-[#C4B9A3] font-mono focus:outline-none focus:border-[#1E3A8A]"
                  disabled={isSubmitting}
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-[#EAE4D5]">
                <button
                  type="button"
                  onClick={closeModals}
                  disabled={isSubmitting}
                  className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-300 text-slate-700 font-bold hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="min-h-[44px] px-5 py-2 rounded-xl bg-[#1E3A8A] text-white font-bold hover:bg-blue-900 transition shadow-sm disabled:opacity-50"
                >
                  {isSubmitting ? 'Updating...' : 'Update Silo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DEACTIVATION CONFIRMATION MODAL */}
      {deactivatingSilo && (
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm Silo Deactivation"
        >
          <div className="bg-white rounded-2xl border border-rose-200 p-6 w-full max-w-md space-y-4 shadow-xl">
            <div className="flex items-center space-x-3 text-rose-700">
              <div className="p-2.5 bg-rose-100 rounded-xl shrink-0">
                <AlertTriangle className="w-5 h-5 text-rose-700" />
              </div>
              <h3 className="text-base font-extrabold text-[#111311]">Deactivate Silo Storage</h3>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Are you sure you want to deactivate silo{' '}
              <strong className="text-[#111311] font-mono">{deactivatingSilo.siloCode}</strong> ({deactivatingSilo.siloName})?
            </p>

            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs space-y-1">
              <div>• The silo will be removed from operational selection immediately.</div>
              <div>• Deactivation is blocked if the silo contains milk stock or active unloadings.</div>
            </div>

            {modalError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-bold flex items-center space-x-2">
                <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{modalError}</span>
              </div>
            )}

            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-[#EAE4D5]">
              <button
                type="button"
                onClick={closeModals}
                disabled={isSubmitting}
                className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-300 text-slate-700 font-bold hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeactivate}
                disabled={isSubmitting}
                className="min-h-[44px] px-5 py-2 rounded-xl bg-rose-600 text-white font-bold hover:bg-rose-700 transition shadow-sm disabled:opacity-50"
              >
                {isSubmitting ? 'Deactivating...' : 'Confirm Deactivate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
