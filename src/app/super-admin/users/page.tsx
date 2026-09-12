'use client';

import React, { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { Users, Plus, KeyRound, Edit2, ShieldAlert, CheckCircle2, AlertTriangle, X } from 'lucide-react';
import {
  CREATABLE_ROLES,
  CreatableRole,
  ROLE_ASSIGNMENT_POLICIES,
  getRoleAssignmentPolicy,
} from '@/lib/user-assignment-policy';

interface Source {
  id: string;
  code: string;
  name: string;
  sourceType: string;
  isActive: boolean;
}

interface UserItem {
  id: string;
  username: string;
  name: string;
  role: string;
  department: string;
  scopeType: string;
  procurementSourceId: string | null;
  procurementSource: Source | null;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export default function SuperAdminUsersPage() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState<UserItem | null>(null);
  const [showResetModal, setShowResetModal] = useState<UserItem | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState<{
    user: UserItem;
    targetStatus: boolean;
  } | null>(null);

  // Modal-specific error states
  const [createModalError, setCreateModalError] = useState<string | null>(null);
  const [editModalError, setEditModalError] = useState<string | null>(null);
  const [resetModalError, setResetModalError] = useState<string | null>(null);
  const [confirmModalError, setConfirmModalError] = useState<string | null>(null);

  // Submitting states
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false);
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);
  const [isSubmittingReset, setIsSubmittingReset] = useState(false);
  const [isSubmittingConfirm, setIsSubmittingConfirm] = useState(false);

  // Create Form states
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<CreatableRole>('SUPER_ADMIN');
  const [procurementSourceId, setProcurementSourceId] = useState('');

  // Edit Form states
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState<CreatableRole>('SUPER_ADMIN');
  const [editProcurementSourceId, setEditProcurementSourceId] = useState('');

  // Password Reset state
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [uRes, sRes] = await Promise.all([
        fetch('/api/super-admin/users'),
        fetch('/api/super-admin/procurement-sources'),
      ]);

      const uData = await uRes.json();
      const sData = await sRes.json();

      if (uRes.ok) setUsers(uData.users || []);
      else setError(uData.error);

      if (sRes.ok) setSources(sData.sources || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const resetForm = () => {
    setUsername('');
    setName('');
    setPassword('');
    setRole('SUPER_ADMIN');
    setProcurementSourceId('');
    setCreateModalError(null);
  };

  const closeCreateModal = () => {
    setShowCreateModal(false);
    resetForm();
  };

  const closeEditModal = () => {
    setShowEditModal(null);
    setEditModalError(null);
  };

  const closeConfirmModal = () => {
    setShowConfirmModal(null);
    setConfirmModalError(null);
  };

  const closeResetModal = () => {
    setShowResetModal(null);
    setNewPassword('');
    setConfirmNewPassword('');
    setResetModalError(null);
  };

  // Keyboard accessibility: Escape closes any open modal and securely clears state
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!isSubmittingCreate && !isSubmittingEdit && !isSubmittingReset && !isSubmittingConfirm) {
          closeCreateModal();
          closeEditModal();
          closeResetModal();
          closeConfirmModal();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSubmittingCreate, isSubmittingEdit, isSubmittingReset, isSubmittingConfirm]);

  const createPolicy = useMemo(
    () => getRoleAssignmentPolicy(role) || ROLE_ASSIGNMENT_POLICIES.SUPER_ADMIN,
    [role]
  );

  const editPolicy = useMemo(
    () => getRoleAssignmentPolicy(editRole) || ROLE_ASSIGNMENT_POLICIES.SUPER_ADMIN,
    [editRole]
  );

  // Sources compatible with current Create Role (strictly active only)
  const createCompatibleSources = useMemo(() => {
    const activeSources = sources.filter((s) => s.isActive);
    if (!createPolicy.requiresSource || !createPolicy.allowedSourceType) {
      return [];
    }
    return activeSources.filter((s) => s.sourceType === createPolicy.allowedSourceType);
  }, [sources, createPolicy]);

  // Sources compatible with current Edit Role (strictly active only)
  const editCompatibleSources = useMemo(() => {
    const activeSources = sources.filter((s) => s.isActive);
    if (!editPolicy.requiresSource || !editPolicy.allowedSourceType) {
      return [];
    }
    return activeSources.filter((s) => s.sourceType === editPolicy.allowedSourceType);
  }, [sources, editPolicy]);

  // Handle role change in Create form with source compatibility
  const handleCreateRoleChange = (newRole: CreatableRole) => {
    setRole(newRole);
    const newPolicy = getRoleAssignmentPolicy(newRole);
    if (newPolicy && newPolicy.requiresSource) {
      const currentSource = sources.find((s) => s.id === procurementSourceId);
      if (!currentSource || !currentSource.isActive || currentSource.sourceType !== newPolicy.allowedSourceType) {
        setProcurementSourceId('');
      }
    } else {
      setProcurementSourceId('');
    }
  };

  // Handle role change in Edit form with source compatibility
  const handleEditRoleChange = (newRole: CreatableRole) => {
    setEditRole(newRole);
    const newPolicy = getRoleAssignmentPolicy(newRole);
    if (newPolicy && newPolicy.requiresSource) {
      const currentSource = sources.find((s) => s.id === editProcurementSourceId);
      if (!currentSource || !currentSource.isActive || currentSource.sourceType !== newPolicy.allowedSourceType) {
        setEditProcurementSourceId('');
      }
    } else {
      setEditProcurementSourceId('');
    }
  };

  const openEditModal = (user: UserItem) => {
    setShowEditModal(user);
    setEditName(user.name || '');
    const validRole: CreatableRole = (CREATABLE_ROLES as readonly string[]).includes(user.role)
      ? (user.role as CreatableRole)
      : 'SUPER_ADMIN';
    setEditRole(validRole);
    const pol = getRoleAssignmentPolicy(validRole);
    if (pol && pol.requiresSource && user.procurementSourceId) {
      const currentSource = sources.find((s) => s.id === user.procurementSourceId);
      if (currentSource && currentSource.isActive && currentSource.sourceType === pol.allowedSourceType) {
        setEditProcurementSourceId(user.procurementSourceId);
      } else {
        setEditProcurementSourceId('');
      }
    } else {
      setEditProcurementSourceId('');
    }
    setEditModalError(null);
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingCreate) return;

    setCreateModalError(null);
    setError(null);
    setSuccessMsg(null);

    const trimmedUsername = username.trim();
    if (!trimmedUsername) {
      setCreateModalError('Username is required.');
      return;
    }

    if (!password || password.length < 8) {
      setCreateModalError('Password must be at least 8 characters long.');
      return;
    }

    if (createPolicy.requiresSource && !procurementSourceId) {
      setCreateModalError(`Please select an active ${createPolicy.allowedSourceType} source for ${createPolicy.label}.`);
      return;
    }

    setIsSubmittingCreate(true);
    try {
      const res = await fetch('/api/super-admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: trimmedUsername,
          name: name.trim(),
          password,
          role,
          procurementSourceId: createPolicy.requiresSource ? procurementSourceId : null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create user');
      }

      setSuccessMsg(`User "${trimmedUsername}" created successfully.`);
      closeCreateModal();
      loadData();
    } catch (err: any) {
      setCreateModalError(err.message || 'Failed to create user');
    } finally {
      setIsSubmittingCreate(false);
    }
  };

  const handleEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showEditModal || isSubmittingEdit) return;

    setEditModalError(null);
    setError(null);
    setSuccessMsg(null);

    if (editPolicy.requiresSource && !editProcurementSourceId) {
      setEditModalError(`Please select an active ${editPolicy.allowedSourceType} source for ${editPolicy.label}.`);
      return;
    }

    setIsSubmittingEdit(true);
    try {
      const res = await fetch(`/api/super-admin/users/${showEditModal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          role: editRole,
          procurementSourceId: editPolicy.requiresSource ? editProcurementSourceId : null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update user');
      }

      setSuccessMsg(`User "${showEditModal.username}" updated successfully.`);
      closeEditModal();
      loadData();
    } catch (err: any) {
      setEditModalError(err.message || 'Failed to update user');
    } finally {
      setIsSubmittingEdit(false);
    }
  };

  const handleConfirmToggleActive = async () => {
    if (!showConfirmModal || isSubmittingConfirm) return;

    setConfirmModalError(null);
    setError(null);
    setSuccessMsg(null);

    const { user, targetStatus } = showConfirmModal;
    setIsSubmittingConfirm(true);

    try {
      const res = await fetch(`/api/super-admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: targetStatus }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update user status');
      }

      setSuccessMsg(`User "${user.username}" ${targetStatus ? 'activated' : 'deactivated'} successfully.`);
      closeConfirmModal();
      loadData();
    } catch (err: any) {
      setConfirmModalError(err.message || 'Failed to update user status');
    } finally {
      setIsSubmittingConfirm(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showResetModal || isSubmittingReset) return;

    setResetModalError(null);
    setError(null);
    setSuccessMsg(null);

    if (!newPassword || newPassword.length < 8) {
      setResetModalError('Password must be at least 8 characters long.');
      return;
    }

    if (newPassword !== confirmNewPassword) {
      setResetModalError('Passwords do not match. Please retype to confirm.');
      return;
    }

    setIsSubmittingReset(true);
    try {
      const res = await fetch(`/api/super-admin/users/${showResetModal.id}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPassword }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to reset password');
      }

      setSuccessMsg(data.message || `Password for "${showResetModal.username}" reset successfully.`);
      closeResetModal();
    } catch (err: any) {
      setResetModalError(err.message || 'Failed to reset password');
    } finally {
      setIsSubmittingReset(false);
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

      {/* USERS TABLE */}
      <div className="bg-white rounded-xl border border-[#EAE4D5]/80 shadow-sm overflow-hidden w-full max-w-full">
        <div className="p-3 sm:px-4 sm:py-3 border-b border-[#EAE4D5] flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <h2 className="text-sm font-bold text-[#111311]">Users</h2>
            <span className="text-[11px] font-mono px-2 py-0.5 bg-[#FDFBF9] border border-[#EAE4D5] text-slate-600 rounded-full">
              {users.length}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              resetForm();
              setShowCreateModal(true);
            }}
            aria-label="Add user"
            title="Add user"
            className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-[#1E3A8A] text-white hover:bg-blue-900 transition shadow-xs"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left text-xs min-w-[700px]">
            <thead className="bg-[#FDFBF9] text-slate-600 border-b border-[#EAE4D5]">
              <tr>
                <th className="p-3 font-bold">User</th>
                <th className="p-3 font-bold">Role</th>
                <th className="p-3 font-bold">Department</th>
                <th className="p-3 font-bold">Data Scope</th>
                <th className="p-3 font-bold">Last Login</th>
                <th className="p-3 font-bold">Status</th>
                <th className="p-3 font-bold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EAE4D5]/60 font-medium">
              {loading ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-slate-400 font-mono">
                    Loading users...
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-slate-400">
                    No users found.
                  </td>
                </tr>
              ) : (
                users.map((u) => {
                  const displayScope = u.scopeType === 'PROCUREMENT_SOURCE' ? 'SOURCE' : u.scopeType;
                  return (
                    <tr key={u.id} className="hover:bg-slate-50">
                      <td className="p-3">
                        <div className="font-bold text-[#111311]">{u.name}</div>
                        <div className="font-mono text-[10px] text-slate-500">@{u.username}</div>
                      </td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold ${
                            u.role === 'SUPER_ADMIN' ? 'bg-indigo-100 text-indigo-900' : 'bg-slate-100 text-slate-800'
                          }`}
                        >
                          {ROLE_ASSIGNMENT_POLICIES[u.role as CreatableRole]?.label || u.role}
                        </span>
                      </td>
                      <td className="p-3 text-slate-600">{u.department || '—'}</td>
                      <td className="p-3">
                        <div className="font-bold text-slate-700">{displayScope}</div>
                        {u.procurementSource && (
                          <div className="text-[10px] text-slate-500 font-mono">
                            {u.procurementSource.name} ({u.procurementSource.sourceType})
                          </div>
                        )}
                      </td>
                      <td className="p-3 font-mono text-[11px] text-slate-500">
                        {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never'}
                      </td>
                      <td className="p-3">
                        {u.isActive ? (
                          <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                            Active
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 text-[10px] font-bold">
                            Deactivated
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end space-x-1.5 sm:space-x-2">
                          <button
                            onClick={() => openEditModal(u)}
                            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-bold transition flex items-center space-x-1"
                            title="Edit User Metadata"
                          >
                            <Edit2 className="w-3 h-3" />
                            <span>Edit</span>
                          </button>
                          <button
                            onClick={() => {
                              setShowResetModal(u);
                              setNewPassword('');
                              setConfirmNewPassword('');
                              setResetModalError(null);
                            }}
                            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-bold transition flex items-center space-x-1"
                            title="Reset Password"
                          >
                            <KeyRound className="w-3 h-3" />
                            <span>Reset Pass</span>
                          </button>
                          <button
                            onClick={() => {
                              setShowConfirmModal({
                                user: u,
                                targetStatus: !u.isActive,
                              });
                              setConfirmModalError(null);
                            }}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition ${
                              u.isActive
                                ? 'bg-rose-50 hover:bg-rose-100 text-rose-700'
                                : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700'
                            }`}
                          >
                            {u.isActive ? 'Deactivate' : 'Activate'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* CREATE USER MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-[#EAE4D5] p-5 sm:p-6 w-full max-w-md my-auto space-y-4 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-[#EAE4D5] pb-3">
              <h3 className="text-base font-extrabold text-[#111311]">Create New User Account</h3>
              <button
                type="button"
                onClick={() => {
                  if (!isSubmittingCreate) {
                    closeCreateModal();
                  }
                }}
                className="p-1 rounded-lg hover:bg-slate-100 text-slate-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {createModalError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-bold flex items-center space-x-2">
                <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{createModalError}</span>
              </div>
            )}

            <form onSubmit={handleCreateUser} className="space-y-3.5 text-xs">
              <div>
                <label htmlFor="create-username" className="font-bold text-slate-700 block mb-1">
                  Username <span className="text-rose-600">*</span>
                </label>
                <input
                  id="create-username"
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-[#C4B9A3] focus:outline-none focus:border-[#1E3A8A]"
                  placeholder="e.g. john.doe"
                  disabled={isSubmittingCreate}
                />
              </div>

              <div>
                <label htmlFor="create-name" className="font-bold text-slate-700 block mb-1">
                  Full Name
                </label>
                <input
                  id="create-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-[#C4B9A3] focus:outline-none focus:border-[#1E3A8A]"
                  placeholder="e.g. John Doe"
                  disabled={isSubmittingCreate}
                />
              </div>

              <div>
                <label htmlFor="create-password" className="font-bold text-slate-700 block mb-1">
                  Password <span className="text-rose-600">*</span>
                </label>
                <input
                  id="create-password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-[#C4B9A3] focus:outline-none focus:border-[#1E3A8A]"
                  placeholder="At least 8 characters"
                  disabled={isSubmittingCreate}
                />
              </div>

              <div>
                <label htmlFor="create-role" className="font-bold text-slate-700 block mb-1">
                  Canonical Role <span className="text-rose-600">*</span>
                </label>
                <select
                  id="create-role"
                  value={role}
                  onChange={(e) => handleCreateRoleChange(e.target.value as CreatableRole)}
                  className="w-full p-2.5 rounded-lg border border-[#C4B9A3] focus:outline-none focus:border-[#1E3A8A]"
                  disabled={isSubmittingCreate}
                >
                  {CREATABLE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_ASSIGNMENT_POLICIES[r].label} ({r})
                    </option>
                  ))}
                </select>
              </div>

              {createPolicy.requiresSource && (
                <div>
                  <label htmlFor="create-source" className="font-bold text-slate-700 block mb-1">
                    Assigned Source <span className="text-rose-600">*</span>
                  </label>
                  <select
                    id="create-source"
                    required
                    value={procurementSourceId}
                    onChange={(e) => setProcurementSourceId(e.target.value)}
                    className="w-full p-2.5 rounded-lg border border-[#C4B9A3] focus:outline-none focus:border-[#1E3A8A]"
                    disabled={isSubmittingCreate}
                  >
                    <option value="">Select Assigned Source...</option>
                    {createCompatibleSources.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.sourceType} - {s.code})
                      </option>
                    ))}
                  </select>
                  {createCompatibleSources.length === 0 && (
                    <p className="text-[11px] text-amber-700 mt-1">
                      No active {createPolicy.allowedSourceType} sources found for role {role}.
                    </p>
                  )}
                  <p className="text-[11px] text-slate-500 mt-1.5 flex items-center justify-between">
                    <span>Source not listed?</span>
                    <Link
                      href="/super-admin/procurement-sources"
                      className="text-[#1E3A8A] font-bold hover:underline shrink-0"
                    >
                      Add it in Procurement Sources →
                    </Link>
                  </p>
                </div>
              )}

              {/* Read-Only Role Assignment Summary */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1 text-xs text-slate-600">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Assignment Details</div>
                <div className="flex justify-between items-center">
                  <span className="font-medium text-slate-500">Department:</span>
                  <span className="font-semibold text-slate-800">{createPolicy.department}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-medium text-slate-500">Data Scope:</span>
                  <span className="font-semibold text-slate-800">{createPolicy.summaryLabel}</span>
                </div>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-[#EAE4D5]">
                <button
                  type="button"
                  disabled={isSubmittingCreate}
                  onClick={() => {
                    if (!isSubmittingCreate) {
                      closeCreateModal();
                    }
                  }}
                  className="px-3.5 py-2 rounded-lg border border-slate-300 text-slate-600 font-bold hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingCreate}
                  className="px-4 py-2 rounded-lg bg-[#1E3A8A] text-white font-bold hover:bg-blue-900 transition disabled:opacity-50"
                >
                  {isSubmittingCreate ? 'Creating...' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT USER MODAL */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-[#EAE4D5] p-5 sm:p-6 w-full max-w-md my-auto space-y-4 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-[#EAE4D5] pb-3">
              <h3 className="text-base font-extrabold text-[#111311]">
                Edit User: <span className="font-mono text-[#1E3A8A]">@{showEditModal.username}</span>
              </h3>
              <button
                type="button"
                onClick={() => {
                  if (!isSubmittingEdit) closeEditModal();
                }}
                className="p-1 rounded-lg hover:bg-slate-100 text-slate-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {editModalError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-bold flex items-center space-x-2">
                <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{editModalError}</span>
              </div>
            )}

            <form onSubmit={handleEditUser} className="space-y-3.5 text-xs">
              <div>
                <label htmlFor="edit-username" className="font-bold text-slate-700 block mb-1">
                  Username (Read-Only)
                </label>
                <input
                  id="edit-username"
                  type="text"
                  readOnly
                  value={showEditModal.username}
                  className="w-full p-2.5 rounded-lg border border-slate-200 bg-slate-100 text-slate-600 font-mono cursor-not-allowed"
                />
              </div>

              <div>
                <label htmlFor="edit-name" className="font-bold text-slate-700 block mb-1">
                  Full Name
                </label>
                <input
                  id="edit-name"
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-[#C4B9A3] focus:outline-none focus:border-[#1E3A8A]"
                  placeholder="e.g. John Doe"
                  disabled={isSubmittingEdit}
                />
              </div>

              <div>
                <label htmlFor="edit-role" className="font-bold text-slate-700 block mb-1">
                  Canonical Role <span className="text-rose-600">*</span>
                </label>
                <select
                  id="edit-role"
                  value={editRole}
                  onChange={(e) => handleEditRoleChange(e.target.value as CreatableRole)}
                  className="w-full p-2.5 rounded-lg border border-[#C4B9A3] focus:outline-none focus:border-[#1E3A8A]"
                  disabled={isSubmittingEdit}
                >
                  {CREATABLE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_ASSIGNMENT_POLICIES[r].label} ({r})
                    </option>
                  ))}
                </select>
              </div>

              {editPolicy.requiresSource && (
                <div>
                  <label htmlFor="edit-source" className="font-bold text-slate-700 block mb-1">
                    Assigned Source <span className="text-rose-600">*</span>
                  </label>
                  <select
                    id="edit-source"
                    required
                    value={editProcurementSourceId}
                    onChange={(e) => setEditProcurementSourceId(e.target.value)}
                    className="w-full p-2.5 rounded-lg border border-[#C4B9A3] focus:outline-none focus:border-[#1E3A8A]"
                    disabled={isSubmittingEdit}
                  >
                    <option value="">Select Assigned Source...</option>
                    {editCompatibleSources.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.sourceType} - {s.code})
                      </option>
                    ))}
                  </select>
                  {editCompatibleSources.length === 0 && (
                    <p className="text-[11px] text-amber-700 mt-1">
                      No active {editPolicy.allowedSourceType} sources found for role {editRole}.
                    </p>
                  )}
                  <p className="text-[11px] text-slate-500 mt-1.5 flex items-center justify-between">
                    <span>Source not listed?</span>
                    <Link
                      href="/super-admin/procurement-sources"
                      className="text-[#1E3A8A] font-bold hover:underline shrink-0"
                    >
                      Add it in Procurement Sources →
                    </Link>
                  </p>
                </div>
              )}

              {/* Read-Only Role Assignment Summary */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1 text-xs text-slate-600">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Assignment Details</div>
                <div className="flex justify-between items-center">
                  <span className="font-medium text-slate-500">Department:</span>
                  <span className="font-semibold text-slate-800">{editPolicy.department}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-medium text-slate-500">Data Scope:</span>
                  <span className="font-semibold text-slate-800">{editPolicy.summaryLabel}</span>
                </div>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-[#EAE4D5]">
                <button
                  type="button"
                  disabled={isSubmittingEdit}
                  onClick={() => {
                    if (!isSubmittingEdit) closeEditModal();
                  }}
                  className="px-3.5 py-2 rounded-lg border border-slate-300 text-slate-600 font-bold hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingEdit}
                  className="px-4 py-2 rounded-lg bg-[#1E3A8A] text-white font-bold hover:bg-blue-900 transition disabled:opacity-50"
                >
                  {isSubmittingEdit ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CONFIRM ACTIVATION / DEACTIVATION MODAL */}
      {showConfirmModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-[#EAE4D5] p-5 sm:p-6 w-full max-w-md my-auto space-y-4 shadow-xl">
            <div className="flex items-center space-x-3">
              <div
                className={`p-2 rounded-xl shrink-0 ${
                  showConfirmModal.targetStatus ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                }`}
              >
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-extrabold text-[#111311]">
                  Confirm {showConfirmModal.targetStatus ? 'Activation' : 'Deactivation'}
                </h3>
                <p className="text-xs text-slate-500">
                  Target Account: <span className="font-mono font-bold text-slate-800">@{showConfirmModal.user.username}</span>
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Current Status:</span>
                <span
                  className={`font-bold ${
                    showConfirmModal.user.isActive ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {showConfirmModal.user.isActive ? 'Active' : 'Deactivated'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Requested Status:</span>
                <span
                  className={`font-bold ${
                    showConfirmModal.targetStatus ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {showConfirmModal.targetStatus ? 'Active' : 'Deactivated'}
                </span>
              </div>
            </div>

            {!showConfirmModal.targetStatus ? (
              <p className="text-xs text-rose-700 font-medium bg-rose-50 p-3 rounded-xl border border-rose-200">
                <strong>Important:</strong> The account will lose access immediately because live database authority is enforced.
              </p>
            ) : (
              <p className="text-xs text-slate-600 font-medium">
                The account will regain access immediately upon entering valid credentials.
              </p>
            )}

            {confirmModalError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-bold flex items-center space-x-2">
                <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{confirmModalError}</span>
              </div>
            )}

            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-[#EAE4D5]">
              <button
                type="button"
                disabled={isSubmittingConfirm}
                onClick={() => {
                  if (!isSubmittingConfirm) closeConfirmModal();
                }}
                className="px-3.5 py-2 rounded-lg border border-slate-300 text-slate-600 font-bold hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSubmittingConfirm}
                onClick={handleConfirmToggleActive}
                className={`px-4 py-2 rounded-lg text-white font-bold transition disabled:opacity-50 ${
                  showConfirmModal.targetStatus
                    ? 'bg-emerald-700 hover:bg-emerald-800'
                    : 'bg-rose-700 hover:bg-rose-800'
                }`}
              >
                {isSubmittingConfirm
                  ? 'Updating...'
                  : showConfirmModal.targetStatus
                  ? 'Confirm Activation'
                  : 'Confirm Deactivation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* RESET PASSWORD MODAL */}
      {showResetModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-[#EAE4D5] p-5 sm:p-6 w-full max-w-md my-auto space-y-4 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-[#EAE4D5] pb-3">
              <div>
                <h3 className="text-base font-extrabold text-[#111311]">
                  Reset Password: <span className="font-mono text-[#1E3A8A]">@{showResetModal.username}</span>
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Password will be hashed with bcrypt. Password will NOT be stored in AuditLog.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!isSubmittingReset) {
                    closeResetModal();
                  }
                }}
                className="p-1 rounded-lg hover:bg-slate-100 text-slate-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {resetModalError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-bold flex items-center space-x-2">
                <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{resetModalError}</span>
              </div>
            )}

            <form onSubmit={handleResetPassword} className="space-y-3.5 text-xs">
              <div>
                <label htmlFor="reset-new-password" className="font-bold text-slate-700 block mb-1">
                  New Password <span className="text-rose-600">*</span>
                </label>
                <input
                  id="reset-new-password"
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-[#C4B9A3] focus:outline-none focus:border-[#1E3A8A]"
                  placeholder="At least 8 characters"
                  disabled={isSubmittingReset}
                />
              </div>

              <div>
                <label htmlFor="reset-confirm-password" className="font-bold text-slate-700 block mb-1">
                  Confirm New Password <span className="text-rose-600">*</span>
                </label>
                <input
                  id="reset-confirm-password"
                  type="password"
                  required
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-[#C4B9A3] focus:outline-none focus:border-[#1E3A8A]"
                  placeholder="Retype new password"
                  disabled={isSubmittingReset}
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-[#EAE4D5]">
                <button
                  type="button"
                  disabled={isSubmittingReset}
                  onClick={() => {
                    if (!isSubmittingReset) {
                      closeResetModal();
                    }
                  }}
                  className="px-3.5 py-2 rounded-lg border border-slate-300 text-slate-600 font-bold hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingReset}
                  className="px-4 py-2 rounded-lg bg-rose-700 text-white font-bold hover:bg-rose-800 transition disabled:opacity-50"
                >
                  {isSubmittingReset ? 'Resetting...' : 'Reset Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
