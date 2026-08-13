'use client';

import React, { useEffect, useState } from 'react';
import { Database, Plus, ShieldAlert, CheckCircle2, Edit2 } from 'lucide-react';

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

  // Form states
  const [siloCode, setSiloCode] = useState('');
  const [siloName, setSiloName] = useState('');
  const [capacityLiters, setCapacityLiters] = useState<number>(100000);

  // Edit form states
  const [editName, setEditName] = useState('');
  const [editCapacity, setEditCapacity] = useState<number>(0);

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
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await fetch('/api/super-admin/silos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siloCode, siloName, capacityLiters }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create silo');

      setSuccessMsg(`Silo "${siloCode}" created successfully.`);
      setShowCreateModal(false);
      setSiloCode('');
      setSiloName('');
      setCapacityLiters(100000);
      loadSilos();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleUpdateSilo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showEditModal) return;
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await fetch(`/api/super-admin/silos/${showEditModal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siloName: editName, capacityLiters: editCapacity }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update silo');

      setSuccessMsg(`Silo "${showEditModal.siloCode}" capacity updated successfully.`);
      setShowEditModal(null);
      loadSilos();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleToggleActive = async (silo: Silo) => {
    setError(null);
    setSuccessMsg(null);
    const newStatus = !silo.isActive;

    try {
      const res = await fetch(`/api/super-admin/silos/${silo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: newStatus }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update silo status');

      setSuccessMsg(`Silo "${silo.siloCode}" ${newStatus ? 'activated' : 'deactivated'} successfully.`);
      loadSilos();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-[#111311]">Silo Storage Management</h1>
          <p className="text-xs font-medium text-slate-500 mt-1">
            Configure plant silo storage capacity. Stock is strictly ledger-derived from physical inventory transactions.
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center space-x-2 px-4 py-2 bg-[#1E3A8A] text-white rounded-xl text-xs font-bold shadow-sm hover:bg-blue-900 transition"
        >
          <Plus className="w-4 h-4" />
          <span>Add Silo Storage</span>
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
      <div className="bg-white rounded-xl border border-[#EAE4D5]/80 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#FDFBF9] text-slate-600 border-b border-[#EAE4D5]">
              <tr>
                <th className="p-3 font-bold">Silo Code</th>
                <th className="p-3 font-bold">Silo Name</th>
                <th className="p-3 font-bold">Total Capacity</th>
                <th className="p-3 font-bold">Ledger Stock (Read-Only)</th>
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
                    <td className="p-3 text-right space-x-2">
                      <button
                        onClick={() => {
                          setShowEditModal(s);
                          setEditName(s.siloName);
                          setEditCapacity(s.capacityLiters);
                        }}
                        className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[11px] font-bold transition"
                      >
                        <Edit2 className="w-3.5 h-3.5 inline mr-1" />
                        Edit Capacity
                      </button>
                      <button
                        onClick={() => handleToggleActive(s)}
                        className={`px-2.5 py-1 rounded text-[11px] font-bold transition ${
                          s.isActive
                            ? 'bg-rose-50 hover:bg-rose-100 text-rose-700'
                            : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700'
                        }`}
                      >
                        {s.isActive ? 'Deactivate' : 'Activate'}
                      </button>
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
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl border border-[#EAE4D5] p-6 w-full max-w-md space-y-4 shadow-xl">
            <h3 className="text-base font-extrabold text-[#111311]">Add Silo Storage</h3>

            <form onSubmit={handleCreateSilo} className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Silo Code *</label>
                <input
                  type="text"
                  required
                  value={siloCode}
                  onChange={(e) => setSiloCode(e.target.value)}
                  className="w-full p-2 rounded-lg border border-[#C4B9A3] uppercase font-mono focus:outline-none focus:border-[#1E3A8A]"
                  placeholder="e.g. SILO-05"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Silo Name *</label>
                <input
                  type="text"
                  required
                  value={siloName}
                  onChange={(e) => setSiloName(e.target.value)}
                  className="w-full p-2 rounded-lg border border-[#C4B9A3] focus:outline-none focus:border-[#1E3A8A]"
                  placeholder="e.g. Storage Silo Tank 05"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Total Capacity (Liters) *</label>
                <input
                  type="number"
                  required
                  min={1}
                  value={capacityLiters}
                  onChange={(e) => setCapacityLiters(Number(e.target.value))}
                  className="w-full p-2 rounded-lg border border-[#C4B9A3] font-mono focus:outline-none focus:border-[#1E3A8A]"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-[#EAE4D5]">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-[#1E3A8A] text-white font-bold hover:bg-blue-900"
                >
                  Save Silo
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT SILO MODAL */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl border border-[#EAE4D5] p-6 w-full max-w-md space-y-4 shadow-xl">
            <h3 className="text-base font-extrabold text-[#111311]">
              Edit Silo Capacity ({showEditModal.siloCode})
            </h3>
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-900 text-[11px] font-medium space-y-1">
              <div>Current Ledger Stock: <strong>{showEditModal.currentStockLiters.toLocaleString()} L</strong></div>
              <div>Active Reservations: <strong>{showEditModal.activeReservationsLiters.toLocaleString()} L</strong></div>
              <div>Minimum Required Capacity: <strong>{(showEditModal.currentStockLiters + showEditModal.activeReservationsLiters).toLocaleString()} L</strong></div>
            </div>

            <form onSubmit={handleUpdateSilo} className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Silo Name</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full p-2 rounded-lg border border-[#C4B9A3] focus:outline-none focus:border-[#1E3A8A]"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Capacity (Liters) *</label>
                <input
                  type="number"
                  required
                  min={showEditModal.currentStockLiters + showEditModal.activeReservationsLiters}
                  value={editCapacity}
                  onChange={(e) => setEditCapacity(Number(e.target.value))}
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
                  Update Capacity
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
