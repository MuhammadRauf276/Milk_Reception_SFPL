'use client';

import React, { useEffect, useState } from 'react';
import { Plus, Edit2, ShieldAlert, CheckCircle2, AlertTriangle, X } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { AnimatePresence } from 'framer-motion';
import { getErrorMessage } from '@/lib/errors';
import { fetchJson } from '@/lib/fetch-json';

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

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState<Source | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState<{
    source: Source;
    targetStatus: boolean;
  } | null>(null);

  // Submitting states
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false);
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);
  const [isSubmittingConfirm, setIsSubmittingConfirm] = useState(false);

  // Modal error states
  const [createModalError, setCreateModalError] = useState<string | null>(null);
  const [editModalError, setEditModalError] = useState<string | null>(null);
  const [confirmModalError, setConfirmModalError] = useState<string | null>(null);

  // Create Form states
  const [createCode, setCreateCode] = useState('');
  const [createName, setCreateName] = useState('');
  const [createSourceType, setCreateSourceType] = useState('ZMCC');

  // Edit Form states
  const [editName, setEditName] = useState('');

  function loadSources() {
    return fetchJson<{ sources?: Source[] }>(
      '/api/super-admin/procurement-sources',
      { cache: 'no-store' },
      'Failed to load procurement sources'
    )
      .then(
        (data) => {
          setSources(data.sources || []);
          setError(null);
        },
        (err) => setError(getErrorMessage(err) || 'Network error loading procurement sources')
      )
      .finally(() => setLoading(false));
  }


  useEffect(() => {
    loadSources();
  }, []);

  const resetCreateForm = () => {
    setCreateCode('');
    setCreateName('');
    setCreateSourceType('ZMCC');
    setCreateModalError(null);
  };

  const closeCreateModal = () => {
    setShowCreateModal(false);
    resetCreateForm();
  };

  const closeEditModal = () => {
    setShowEditModal(null);
    setEditName('');
    setEditModalError(null);
  };

  const closeConfirmModal = () => {
    setShowConfirmModal(null);
    setConfirmModalError(null);
  };


  const handleCreateSource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingCreate) return;

    setCreateModalError(null);
    setError(null);
    setSuccessMsg(null);

    const normalizedCode = createCode.trim().toUpperCase();
    const trimmedName = createName.trim();

    if (!normalizedCode) {
      setCreateModalError('Source code is required.');
      return;
    }
    if (!trimmedName) {
      setCreateModalError('Source name is required.');
      return;
    }

    setIsSubmittingCreate(true);
    try {
      const res = await fetch('/api/super-admin/procurement-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: normalizedCode,
          name: trimmedName,
          sourceType: createSourceType,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create procurement source');
      }

      setSuccessMsg(`Procurement source "${trimmedName}" (${normalizedCode}) created successfully.`);
      closeCreateModal();
      await loadSources();
    } catch (err) {
      setCreateModalError(getErrorMessage(err) || 'Failed to create procurement source');
    } finally {
      setIsSubmittingCreate(false);
    }
  };

  const openEditModal = (source: Source) => {
    setShowEditModal(source);
    setEditName(source.name);
    setEditModalError(null);
  };

  const handleEditSource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showEditModal || isSubmittingEdit) return;

    setEditModalError(null);
    setError(null);
    setSuccessMsg(null);

    const trimmedName = editName.trim();
    if (!trimmedName) {
      setEditModalError('Source name cannot be empty.');
      return;
    }

    setIsSubmittingEdit(true);
    try {
      const res = await fetch(`/api/super-admin/procurement-sources/${showEditModal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update procurement source');
      }

      setSuccessMsg(`Procurement source "${trimmedName}" updated successfully.`);
      closeEditModal();
      await loadSources();
    } catch (err) {
      setEditModalError(getErrorMessage(err) || 'Failed to update procurement source');
    } finally {
      setIsSubmittingEdit(false);
    }
  };

  const openConfirmModal = (source: Source) => {
    setShowConfirmModal({
      source,
      targetStatus: !source.isActive,
    });
    setConfirmModalError(null);
  };

  const handleConfirmToggle = async () => {
    if (!showConfirmModal || isSubmittingConfirm) return;

    setConfirmModalError(null);
    setError(null);
    setSuccessMsg(null);

    const { source, targetStatus } = showConfirmModal;
    setIsSubmittingConfirm(true);

    try {
      const res = await fetch(`/api/super-admin/procurement-sources/${source.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: targetStatus }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Failed to ${targetStatus ? 'activate' : 'deactivate'} procurement source`);
      }

      setSuccessMsg(
        `Source "${source.name}" (${source.code}) ${targetStatus ? 'activated' : 'deactivated'} successfully.`
      );
      closeConfirmModal();
      await loadSources();
    } catch (err) {
      setConfirmModalError(getErrorMessage(err) || 'Failed to update procurement source status');
    } finally {
      setIsSubmittingConfirm(false);
    }
  };

  return (
    <div className="space-y-4 w-full max-w-full overflow-x-hidden">
      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-semibold flex items-center space-x-2 animate-panel-in">
          <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs font-semibold flex items-center space-x-2 animate-panel-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* SOURCES TABLE */}
      <div className="bg-white rounded-xl border border-border/80 shadow-xs overflow-hidden w-full max-w-full">
        <div className="p-3 sm:px-4 sm:py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <h2 className="text-sm font-semibold text-foreground">Procurement Sources</h2>
            <span className="text-[11px] tabular-nums px-2 py-0.5 bg-subtle border border-border text-slate-600 rounded-full">
              {sources.length}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              resetCreateForm();
              setShowCreateModal(true);
            }}
            aria-label="Add procurement source"
            title="Add procurement source"
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground shadow-2xs transition-colors hover:bg-primary-hover focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Plus className="w-4 h-4" />
            <span>Add source</span>
          </button>
        </div>

        <div className="overflow-x-auto w-full">
          <table className="w-full text-left text-xs min-w-[600px]">
            <thead className="bg-subtle text-slate-600 border-b border-border">
              <tr>
                <th className="p-3 font-semibold">Code</th>
                <th className="p-3 font-semibold">Name</th>
                <th className="p-3 font-semibold">Source Type</th>
                <th className="p-3 font-semibold">Status</th>
                <th className="p-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 font-medium">
              {loading ? (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-slate-400 tabular-nums">
                    Loading procurement sources…
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
                  <tr key={s.id} className="hover:bg-slate-50 transition">
                    <td className="p-3 tabular-nums font-semibold text-foreground">{s.code}</td>
                    <td className="p-3 font-semibold text-slate-800">{s.name}</td>
                    <td className="p-3">
                      <span
                        className={`px-2 py-0.5 rounded tabular-nums text-[10px] font-semibold ${
                          s.sourceType === 'ZMCC' ? 'bg-blue-100 text-blue-900' : 'bg-slate-100 text-slate-800 border border-slate-200'
                        }`}
                      >
                        {s.sourceType}
                      </span>
                    </td>
                    <td className="p-3">
                      {s.isActive ? (
                        <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-semibold">
                          Active
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 text-[10px] font-semibold">
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end space-x-1">
                        <button
                          type="button"
                          onClick={() => openEditModal(s)}
                          aria-label={`Edit ${s.name}`}
                          title={`Edit ${s.name}`}
                          className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-600 transition"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openConfirmModal(s)}
                          aria-label={`${s.isActive ? 'Deactivate' : 'Activate'} ${s.name}`}
                          className={`px-2.5 py-1.5 min-h-[44px] rounded-lg text-[11px] font-semibold transition flex items-center justify-center ${
                            s.isActive
                              ? 'bg-rose-50 hover:bg-rose-100 text-rose-700'
                              : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700'
                          }`}
                        >
                          {s.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* CREATE SOURCE MODAL */}
      <AnimatePresence>{showCreateModal && (
        <Modal key="modal-0" onClose={closeCreateModal} title="Add procurement source" preventClose={isSubmittingCreate} className="p-6 max-w-md space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h3 className="text-base font-semibold text-foreground">Add Procurement Source</h3>
              <button
                type="button"
                onClick={closeCreateModal}
                disabled={isSubmittingCreate}
                aria-label="Close add procurement source dialog"
                className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {createModalError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-semibold flex items-center space-x-2">
                <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{createModalError}</span>
              </div>
            )}

            <form onSubmit={handleCreateSource} className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Source Code *</label>
                <input
                  type="text"
                  required
                  value={createCode}
                  onChange={(e) => setCreateCode(e.target.value)}
                  disabled={isSubmittingCreate}
                  className="w-full p-2.5 rounded-lg border border-border-strong uppercase tabular-nums focus:outline-hidden focus:border-primary"
                  placeholder="e.g. ZMCC-FAISALABAD"
                />
                <p className="text-[10px] text-slate-400 mt-1">Code is immutable once created.</p>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Source Name *</label>
                <input
                  type="text"
                  required
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  disabled={isSubmittingCreate}
                  className="w-full p-2.5 rounded-lg border border-border-strong focus:outline-hidden focus:border-primary"
                  placeholder="e.g. Faisalabad ZMCC Center"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Source Type *</label>
                <select
                  value={createSourceType}
                  onChange={(e) => setCreateSourceType(e.target.value)}
                  disabled={isSubmittingCreate}
                  className="w-full p-2.5 rounded-lg border border-border-strong focus:outline-hidden focus:border-primary"
                >
                  <option value="ZMCC">ZMCC</option>
                  <option value="CONTRACTOR">Contractor</option>
                </select>
                <p className="text-[10px] text-slate-400 mt-1">Source type is immutable once created.</p>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={closeCreateModal}
                  disabled={isSubmittingCreate}
                  className="px-3 py-2 min-h-[44px] rounded-lg border border-slate-300 text-slate-600 font-semibold hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingCreate}
                  className="px-4 py-2 min-h-[44px] rounded-lg bg-primary text-white font-semibold hover:bg-primary-hover transition disabled:opacity-50"
                >
                  {isSubmittingCreate ? 'Saving…' : 'Save Source'}
                </button>
              </div>
            </form>
          </Modal>
      )}</AnimatePresence>

      {/* EDIT SOURCE MODAL */}
      <AnimatePresence>{showEditModal && (
        <Modal key="modal-1" onClose={closeEditModal} title="Edit procurement source" preventClose={isSubmittingEdit} className="p-6 max-w-md space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h3 className="text-base font-semibold text-foreground">Edit Procurement Source</h3>
              <button
                type="button"
                onClick={closeEditModal}
                disabled={isSubmittingEdit}
                aria-label="Close edit procurement source dialog"
                className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {editModalError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-semibold flex items-center space-x-2">
                <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{editModalError}</span>
              </div>
            )}

            <form onSubmit={handleEditSource} className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Source Code</label>
                <input
                  type="text"
                  disabled
                  value={showEditModal.code}
                  className="w-full p-2.5 rounded-lg border border-slate-200 bg-slate-100 tabular-nums text-slate-500 cursor-not-allowed"
                />
                <p className="text-[10px] text-slate-400 mt-1">Source code is immutable and cannot be modified.</p>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Source Type</label>
                <input
                  type="text"
                  disabled
                  value={showEditModal.sourceType}
                  className="w-full p-2.5 rounded-lg border border-slate-200 bg-slate-100 tabular-nums text-slate-500 cursor-not-allowed"
                />
                <p className="text-[10px] text-slate-400 mt-1">Source type is immutable and cannot be modified.</p>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Source Name *</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  disabled={isSubmittingEdit}
                  className="w-full p-2.5 rounded-lg border border-border-strong focus:outline-hidden focus:border-primary"
                  placeholder="e.g. Faisalabad ZMCC Center"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={closeEditModal}
                  disabled={isSubmittingEdit}
                  className="px-3 py-2 min-h-[44px] rounded-lg border border-slate-300 text-slate-600 font-semibold hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingEdit}
                  className="px-4 py-2 min-h-[44px] rounded-lg bg-primary text-white font-semibold hover:bg-primary-hover transition disabled:opacity-50"
                >
                  {isSubmittingEdit ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </form>
          </Modal>
      )}</AnimatePresence>

      {/* CONFIRM TOGGLE STATUS MODAL */}
      <AnimatePresence>{showConfirmModal && (
        <Modal key="modal-2" onClose={closeConfirmModal} title="Confirm source status change" preventClose={isSubmittingConfirm} closeOnOutsideClick className="p-6 max-w-md space-y-4">
            <div className="flex items-center space-x-3">
              <div
                className={`p-2 rounded-xl shrink-0 ${
                  showConfirmModal.targetStatus ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'
                }`}
              >
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-foreground">
                  {showConfirmModal.targetStatus ? 'Activate' : 'Deactivate'} Source?
                </h3>
                <p className="text-xs text-slate-500 tabular-nums">{showConfirmModal.source.code}</p>
              </div>
            </div>

            {confirmModalError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-semibold flex items-center space-x-2">
                <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{confirmModalError}</span>
              </div>
            )}

            <div className="text-xs text-slate-600 space-y-2">
              <p>
                Are you sure you want to {showConfirmModal.targetStatus ? 'activate' : 'deactivate'}{' '}
                <strong className="text-slate-800 font-semibold">{showConfirmModal.source.name}</strong>?
              </p>
              {!showConfirmModal.targetStatus ? (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-900 text-[11px] space-y-1 font-medium">
                  <p className="font-semibold">Deactivation Effects & Guards:</p>
                  <ul className="list-disc list-inside space-y-0.5 text-amber-800">
                    <li>Will be excluded from active operational dispatch selectors.</li>
                    <li>Cannot be deactivated if active users are currently assigned.</li>
                    <li>Cannot be deactivated if incomplete vehicle visits are in progress.</li>
                    <li>Remains visible to Super Admins with Inactive status.</li>
                  </ul>
                </div>
              ) : (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-emerald-900 text-[11px] space-y-1 font-medium">
                  <p className="font-semibold">Activation Effects:</p>
                  <p className="text-emerald-800">
                    Will restore availability in operational selectors and allow user assignments.
                  </p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-border">
              <button
                type="button"
                onClick={closeConfirmModal}
                disabled={isSubmittingConfirm}
                className="px-3 py-2 min-h-[44px] rounded-lg border border-slate-300 text-slate-600 font-semibold hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmToggle}
                disabled={isSubmittingConfirm}
                className={`px-4 py-2 min-h-[44px] rounded-lg font-semibold text-white transition disabled:opacity-50 ${
                  showConfirmModal.targetStatus
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-rose-600 hover:bg-rose-700'
                }`}
              >
                {isSubmittingConfirm
                  ? 'Processing…'
                  : showConfirmModal.targetStatus
                  ? 'Activate Source'
                  : 'Deactivate Source'}
              </button>
            </div>
          </Modal>
      )}</AnimatePresence>
    </div>
  );
}
