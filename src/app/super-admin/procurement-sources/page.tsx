'use client';

import React, { useEffect, useState } from 'react';
import { Truck, Plus, ShieldAlert, CheckCircle2 } from 'lucide-react';

interface Source {
  id: string;
  code: string;
  name: string;
  sourceType: string;
  isActive: boolean;
  createdAt: string;
}

export default function SuperAdminProcurementSourcesPage() {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Form states
  const [showModal, setShowModal] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [sourceType, setSourceType] = useState('ZMCC');

  async function loadSources() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/super-admin/procurement-sources');
      const data = await res.json();
      if (res.ok) setSources(data.sources || []);
      else setError(data.error);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSources();
  }, []);

  const handleCreateSource = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await fetch('/api/super-admin/procurement-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, name, sourceType }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create procurement source');

      setSuccessMsg(`Procurement source "${name}" created successfully.`);
      setShowModal(false);
      setCode('');
      setName('');
      setSourceType('ZMCC');
      loadSources();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleToggleActive = async (source: Source) => {
    setError(null);
    setSuccessMsg(null);
    const newStatus = !source.isActive;

    try {
      const res = await fetch(`/api/super-admin/procurement-sources/${source.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: newStatus }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update status');

      setSuccessMsg(`Source "${source.name}" ${newStatus ? 'activated' : 'deactivated'} successfully.`);
      loadSources();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-[#111311]">Procurement Sources Management</h1>
          <p className="text-xs font-medium text-slate-500 mt-1">
            Configure ZMCC milk procurement centers and contractor masters in PostgreSQL database.
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center space-x-2 px-4 py-2 bg-[#1E3A8A] text-white rounded-xl text-xs font-bold shadow-sm hover:bg-blue-900 transition"
        >
          <Plus className="w-4 h-4" />
          <span>Add Procurement Source</span>
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

      {/* SOURCES TABLE */}
      <div className="bg-white rounded-xl border border-[#EAE4D5]/80 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#FDFBF9] text-slate-600 border-b border-[#EAE4D5]">
              <tr>
                <th className="p-3 font-bold">Code</th>
                <th className="p-3 font-bold">Name</th>
                <th className="p-3 font-bold">Source Type</th>
                <th className="p-3 font-bold">Status</th>
                <th className="p-3 font-bold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EAE4D5]/60 font-medium">
              {loading ? (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-slate-400 font-mono">
                    Loading procurement sources...
                  </td>
                </tr>
              ) : sources.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-slate-400">
                    No procurement sources configured.
                  </td>
                </tr>
              ) : (
                sources.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="p-3 font-mono font-bold text-[#111311]">{s.code}</td>
                    <td className="p-3 font-bold text-slate-800">{s.name}</td>
                    <td className="p-3">
                      <span
                        className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold ${
                          s.sourceType === 'ZMCC' ? 'bg-blue-100 text-blue-900' : 'bg-purple-100 text-purple-900'
                        }`}
                      >
                        {s.sourceType}
                      </span>
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

      {/* CREATE SOURCE MODAL */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl border border-[#EAE4D5] p-6 w-full max-w-md space-y-4 shadow-xl">
            <h3 className="text-base font-extrabold text-[#111311]">Add Procurement Source</h3>

            <form onSubmit={handleCreateSource} className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Source Code *</label>
                <input
                  type="text"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="w-full p-2 rounded-lg border border-[#C4B9A3] uppercase font-mono focus:outline-none focus:border-[#1E3A8A]"
                  placeholder="e.g. ZMCC-FAISALABAD"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Source Name *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full p-2 rounded-lg border border-[#C4B9A3] focus:outline-none focus:border-[#1E3A8A]"
                  placeholder="e.g. Faisalabad ZMCC Center"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Source Type *</label>
                <select
                  value={sourceType}
                  onChange={(e) => setSourceType(e.target.value)}
                  className="w-full p-2 rounded-lg border border-[#C4B9A3] focus:outline-none focus:border-[#1E3A8A]"
                >
                  <option value="ZMCC">ZMCC (Direct Procurement Center)</option>
                  <option value="CONTRACTOR">CONTRACTOR (Third-Party Supplier)</option>
                </select>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-[#EAE4D5]">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-[#1E3A8A] text-white font-bold hover:bg-blue-900"
                >
                  Save Source
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
