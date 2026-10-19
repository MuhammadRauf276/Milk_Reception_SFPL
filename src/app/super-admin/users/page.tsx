'use client';

import React, { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { Plus, KeyRound, Edit2, ShieldAlert, CheckCircle2, AlertTriangle, X, MoreHorizontal, UserX, UserCheck } from 'lucide-react';
import {
  CREATABLE_ROLES,
  CreatableRole,
  ROLE_ASSIGNMENT_POLICIES,
  getRoleAssignmentPolicy,
} from '@/lib/user-assignment-policy';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AnimatePresence } from 'framer-motion';
import { getErrorMessage } from '@/lib/errors';
import { fetchJson } from '@/lib/fetch-json';

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
  email: string | null;
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
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<CreatableRole>('SUPER_ADMIN');
  const [procurementSourceId, setProcurementSourceId] = useState('');

  // Edit Form states
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState<CreatableRole>('SUPER_ADMIN');
  const [editProcurementSourceId, setEditProcurementSourceId] = useState('');

  // Password Reset state
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  function loadData() {
    return Promise.allSettled([
      fetchJson<{ users?: UserItem[] }>('/api/super-admin/users', undefined, 'Failed to load users.'),
      fetchJson<{ sources?: Source[] }>('/api/super-admin/procurement-sources'),
    ])
      .then(([usersResult, sourcesResult]) => {
        if (usersResult.status === 'fulfilled') {
          setUsers(usersResult.value.users || []);
          setError(null);
        } else {
          setError(getErrorMessage(usersResult.reason));
        }
        if (sourcesResult.status === 'fulfilled') setSources(sourcesResult.value.sources || []);
      })
      .finally(() => setLoading(false));
  }


  useEffect(() => {
    loadData();
  }, []);

  const resetForm = () => {
    setUsername('');
    setEmail('');
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
    setEditEmail(user.email || '');
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

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setCreateModalError('Email address is required.');
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
          email: trimmedEmail,
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
    } catch (err) {
      setCreateModalError(getErrorMessage(err) || 'Failed to create user');
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

    const trimmedEditEmail = editEmail.trim();
    if (showEditModal.email && !trimmedEditEmail) {
      setEditModalError('Email address cannot be cleared.');
      return;
    }

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
          ...(trimmedEditEmail ? { email: trimmedEditEmail } : {}),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update user');
      }

      setSuccessMsg(`User "${showEditModal.username}" updated successfully.`);
      closeEditModal();
      loadData();
    } catch (err) {
      setEditModalError(getErrorMessage(err) || 'Failed to update user');
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
    } catch (err) {
      setConfirmModalError(getErrorMessage(err) || 'Failed to update user status');
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
    } catch (err) {
      setResetModalError(getErrorMessage(err) || 'Failed to reset password');
    } finally {
      setIsSubmittingReset(false);
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

      {/* USERS TABLE */}
      <div className="bg-white rounded-xl border border-border/80 shadow-xs overflow-hidden w-full max-w-full">
        <div className="p-3 sm:px-4 sm:py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <h2 className="text-sm font-semibold text-foreground">Users</h2>
            <span className="text-[11px] tabular-nums px-2 py-0.5 bg-subtle border border-border text-slate-600 rounded-full">
              {users.length}
            </span>
          </div>
          <Button
            size="sm"
            onClick={() => {
              resetForm();
              setShowCreateModal(true);
            }}
          >
            <Plus />
            Add user
          </Button>
        </div>
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left text-xs min-w-[700px]">
            <thead className="bg-subtle text-slate-600 border-b border-border">
              <tr>
                <th className="p-3 font-semibold">User</th>
                <th className="p-3 font-semibold">Email</th>
                <th className="p-3 font-semibold">Role</th>
                <th className="p-3 font-semibold">Department</th>
                <th className="p-3 font-semibold">Data Scope</th>
                <th className="p-3 font-semibold">Last Login</th>
                <th className="p-3 font-semibold">Status</th>
                <th className="p-3 font-semibold text-right"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 font-medium">
              {loading ? (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-slate-400 tabular-nums">
                    Loading users…
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-slate-400">
                    No users found.
                  </td>
                </tr>
              ) : (
                users.map((u) => {
                  const displayScope = u.scopeType === 'PROCUREMENT_SOURCE' ? 'SOURCE' : u.scopeType;
                  return (
                    <tr key={u.id} className="hover:bg-slate-50">
                      <td className="p-3">
                        <div className="font-semibold text-foreground">{u.name}</div>
                        <div className="tabular-nums text-[10px] text-slate-500">@{u.username}</div>
                      </td>
                      <td className="p-3 tabular-nums text-[11px] text-slate-600">
                        {u.email ? (
                          u.email
                        ) : (
                          <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-medium">
                            Not set
                          </span>
                        )}
                      </td>
                      <td className="p-3">
                        <span
                          className={`inline-block whitespace-nowrap px-2 py-0.5 rounded-md text-[11px] font-medium ${
                            u.role === 'SUPER_ADMIN' ? 'bg-primary/10 text-primary' : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {ROLE_ASSIGNMENT_POLICIES[u.role as CreatableRole]?.label || u.role}
                        </span>
                      </td>
                      <td className="p-3 text-slate-600">{u.department || '—'}</td>
                      <td className="p-3">
                        <div className="font-semibold text-slate-700">{displayScope}</div>
                        {u.procurementSource && (
                          <div className="text-[10px] text-slate-500 tabular-nums">
                            {u.procurementSource.name} ({u.procurementSource.sourceType})
                          </div>
                        )}
                      </td>
                      <td className="p-3 tabular-nums text-[11px] text-slate-500 whitespace-nowrap">
                        {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never'}
                      </td>
                      <td className="p-3">
                        {u.isActive ? (
                          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-700">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
                            <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
                            Deactivated
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${u.name}`}>
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuItem onSelect={() => openEditModal(u)}>
                              <Edit2 />
                              Edit details
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => {
                                setShowResetModal(u);
                                setNewPassword('');
                                setConfirmNewPassword('');
                                setResetModalError(null);
                              }}
                            >
                              <KeyRound />
                              Reset password
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              destructive={u.isActive}
                              onSelect={() => {
                                setShowConfirmModal({
                                  user: u,
                                  targetStatus: !u.isActive,
                                });
                                setConfirmModalError(null);
                              }}
                            >
                              {u.isActive ? <UserX /> : <UserCheck />}
                              {u.isActive ? 'Deactivate' : 'Activate'}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
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
      <AnimatePresence>{showCreateModal && (
        <Modal key="modal-0" onClose={closeCreateModal} title="Create user account" preventClose={isSubmittingCreate} className="p-5 sm:p-6 max-w-md space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-semibold text-foreground">Create New User Account</h3>
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
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-semibold flex items-center space-x-2">
                <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{createModalError}</span>
              </div>
            )}

            <form onSubmit={handleCreateUser} className="space-y-3.5 text-xs">
              <div>
                <label htmlFor="create-username" className="font-semibold text-slate-700 block mb-1">
                  Username <span className="text-rose-600">*</span>
                </label>
                <input
                  id="create-username"
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-border-strong focus:outline-hidden focus:border-primary"
                  placeholder="e.g. john.doe"
                  disabled={isSubmittingCreate}
                />
              </div>

              <div>
                <label htmlFor="create-email" className="font-semibold text-slate-700 block mb-1">
                  Email Address <span className="text-rose-600">*</span>
                </label>
                <input
                  id="create-email"
                  type="email"
                  required
                  maxLength={254}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-border-strong focus:outline-hidden focus:border-primary"
                  placeholder="e.g. john.doe@example.com"
                  disabled={isSubmittingCreate}
                />
              </div>

              <div>
                <label htmlFor="create-name" className="font-semibold text-slate-700 block mb-1">
                  Full Name
                </label>
                <input
                  id="create-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-border-strong focus:outline-hidden focus:border-primary"
                  placeholder="e.g. John Doe"
                  disabled={isSubmittingCreate}
                />
              </div>

              <div>
                <label htmlFor="create-password" className="font-semibold text-slate-700 block mb-1">
                  Password <span className="text-rose-600">*</span>
                </label>
                <input
                  id="create-password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-border-strong focus:outline-hidden focus:border-primary"
                  placeholder="At least 8 characters"
                  disabled={isSubmittingCreate}
                />
              </div>

              <div>
                <label htmlFor="create-role" className="font-semibold text-slate-700 block mb-1">
                  Canonical Role <span className="text-rose-600">*</span>
                </label>
                <select
                  id="create-role"
                  value={role}
                  onChange={(e) => handleCreateRoleChange(e.target.value as CreatableRole)}
                  className="w-full p-2.5 rounded-lg border border-border-strong focus:outline-hidden focus:border-primary"
                  disabled={isSubmittingCreate}
                >
                  {CREATABLE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_ASSIGNMENT_POLICIES[r].label}
                    </option>
                  ))}
                </select>
              </div>

              {createPolicy.requiresSource && (
                <div>
                  <label htmlFor="create-source" className="font-semibold text-slate-700 block mb-1">
                    Assigned Source <span className="text-rose-600">*</span>
                  </label>
                  <select
                    id="create-source"
                    required
                    value={procurementSourceId}
                    onChange={(e) => setProcurementSourceId(e.target.value)}
                    className="w-full p-2.5 rounded-lg border border-border-strong focus:outline-hidden focus:border-primary"
                    disabled={isSubmittingCreate}
                  >
                    <option value="">Select source</option>
                    {createCompatibleSources.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} · {s.code}
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
                      className="text-primary font-semibold hover:underline shrink-0"
                    >
                      Add it in Procurement Sources
                    </Link>
                  </p>
                </div>
              )}

              {/* Read-Only Role Assignment Summary */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1 text-xs text-slate-600">
                <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Assignment Details</div>
                <div className="flex justify-between items-center">
                  <span className="font-medium text-slate-500">Department:</span>
                  <span className="font-semibold text-slate-800">{createPolicy.department}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-medium text-slate-500">Data Scope:</span>
                  <span className="font-semibold text-slate-800">{createPolicy.summaryLabel}</span>
                </div>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-border">
                <button
                  type="button"
                  disabled={isSubmittingCreate}
                  onClick={() => {
                    if (!isSubmittingCreate) {
                      closeCreateModal();
                    }
                  }}
                  className="px-3.5 py-2 rounded-lg border border-slate-300 text-slate-600 font-semibold hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingCreate}
                  className="px-4 py-2 rounded-lg bg-primary text-white font-semibold hover:bg-primary-hover transition disabled:opacity-50"
                >
                  {isSubmittingCreate ? 'Creating…' : 'Create User'}
                </button>
              </div>
            </form>
          </Modal>
      )}</AnimatePresence>

      {/* EDIT USER MODAL */}
      <AnimatePresence>{showEditModal && (
        <Modal key="modal-1" onClose={closeEditModal} title="Edit user" preventClose={isSubmittingEdit} className="p-5 sm:p-6 max-w-md space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-semibold text-foreground">
                Edit User: <span className="tabular-nums text-primary">@{showEditModal.username}</span>
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
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-semibold flex items-center space-x-2">
                <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{editModalError}</span>
              </div>
            )}

            <form onSubmit={handleEditUser} className="space-y-3.5 text-xs">
              <div>
                <label htmlFor="edit-username" className="font-semibold text-slate-700 block mb-1">
                  Username (Read-Only)
                </label>
                <input
                  id="edit-username"
                  type="text"
                  readOnly
                  value={showEditModal.username}
                  className="w-full p-2.5 rounded-lg border border-slate-200 bg-slate-100 text-slate-600 tabular-nums cursor-not-allowed"
                />
              </div>

              <div>
                <label htmlFor="edit-email" className="font-semibold text-slate-700 block mb-1">
                  Email Address {showEditModal.email ? <span className="text-slate-400 font-normal">(Cannot be cleared)</span> : <span className="text-amber-600 font-normal">(Required to activate)</span>}
                </label>
                <input
                  id="edit-email"
                  type="email"
                  maxLength={254}
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-border-strong focus:outline-hidden focus:border-primary"
                  placeholder={showEditModal.email || 'e.g. user@example.com'}
                  disabled={isSubmittingEdit}
                />
              </div>

              <div>
                <label htmlFor="edit-name" className="font-semibold text-slate-700 block mb-1">
                  Full Name
                </label>
                <input
                  id="edit-name"
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-border-strong focus:outline-hidden focus:border-primary"
                  placeholder="e.g. John Doe"
                  disabled={isSubmittingEdit}
                />
              </div>

              <div>
                <label htmlFor="edit-role" className="font-semibold text-slate-700 block mb-1">
                  Canonical Role <span className="text-rose-600">*</span>
                </label>
                <select
                  id="edit-role"
                  value={editRole}
                  onChange={(e) => handleEditRoleChange(e.target.value as CreatableRole)}
                  className="w-full p-2.5 rounded-lg border border-border-strong focus:outline-hidden focus:border-primary"
                  disabled={isSubmittingEdit}
                >
                  {CREATABLE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_ASSIGNMENT_POLICIES[r].label}
                    </option>
                  ))}
                </select>
              </div>

              {editPolicy.requiresSource && (
                <div>
                  <label htmlFor="edit-source" className="font-semibold text-slate-700 block mb-1">
                    Assigned Source <span className="text-rose-600">*</span>
                  </label>
                  <select
                    id="edit-source"
                    required
                    value={editProcurementSourceId}
                    onChange={(e) => setEditProcurementSourceId(e.target.value)}
                    className="w-full p-2.5 rounded-lg border border-border-strong focus:outline-hidden focus:border-primary"
                    disabled={isSubmittingEdit}
                  >
                    <option value="">Select source</option>
                    {editCompatibleSources.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} · {s.code}
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
                      className="text-primary font-semibold hover:underline shrink-0"
                    >
                      Add it in Procurement Sources
                    </Link>
                  </p>
                </div>
              )}

              {/* Read-Only Role Assignment Summary */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1 text-xs text-slate-600">
                <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Assignment Details</div>
                <div className="flex justify-between items-center">
                  <span className="font-medium text-slate-500">Department:</span>
                  <span className="font-semibold text-slate-800">{editPolicy.department}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-medium text-slate-500">Data Scope:</span>
                  <span className="font-semibold text-slate-800">{editPolicy.summaryLabel}</span>
                </div>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-border">
                <button
                  type="button"
                  disabled={isSubmittingEdit}
                  onClick={() => {
                    if (!isSubmittingEdit) closeEditModal();
                  }}
                  className="px-3.5 py-2 rounded-lg border border-slate-300 text-slate-600 font-semibold hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingEdit}
                  className="px-4 py-2 rounded-lg bg-primary text-white font-semibold hover:bg-primary-hover transition disabled:opacity-50"
                >
                  {isSubmittingEdit ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </form>
          </Modal>
      )}</AnimatePresence>

      {/* CONFIRM ACTIVATION / DEACTIVATION MODAL */}
      <AnimatePresence>{showConfirmModal && (
        <Modal key="modal-2" onClose={closeConfirmModal} title="Confirm account status change" preventClose={isSubmittingConfirm} className="p-5 sm:p-6 max-w-md space-y-4">
            <div className="flex items-center space-x-3">
              <div
                className={`p-2 rounded-xl shrink-0 ${
                  showConfirmModal.targetStatus ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                }`}
              >
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-foreground">
                  Confirm {showConfirmModal.targetStatus ? 'Activation' : 'Deactivation'}
                </h3>
                <p className="text-xs text-slate-500">
                  Target Account: <span className="tabular-nums font-semibold text-slate-800">@{showConfirmModal.user.username}</span>
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Current Status:</span>
                <span
                  className={`font-semibold ${
                    showConfirmModal.user.isActive ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {showConfirmModal.user.isActive ? 'Active' : 'Deactivated'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Requested Status:</span>
                <span
                  className={`font-semibold ${
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

            {showConfirmModal.targetStatus && !showConfirmModal.user.email && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>
                  This account has no email set. An email is required before activation. Please edit the account to provide an email first.
                </span>
              </div>
            )}

            {confirmModalError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-semibold flex items-center space-x-2">
                <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{confirmModalError}</span>
              </div>
            )}

            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-border">
              <button
                type="button"
                disabled={isSubmittingConfirm}
                onClick={() => {
                  if (!isSubmittingConfirm) closeConfirmModal();
                }}
                className="px-3.5 py-2 rounded-lg border border-slate-300 text-slate-600 font-semibold hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSubmittingConfirm}
                onClick={handleConfirmToggleActive}
                className={`px-4 py-2 rounded-lg text-white font-semibold transition disabled:opacity-50 ${
                  showConfirmModal.targetStatus
                    ? 'bg-emerald-700 hover:bg-emerald-800'
                    : 'bg-rose-700 hover:bg-rose-800'
                }`}
              >
                {isSubmittingConfirm
                  ? 'Updating…'
                  : showConfirmModal.targetStatus
                  ? 'Confirm Activation'
                  : 'Confirm Deactivation'}
              </button>
            </div>
          </Modal>
      )}</AnimatePresence>

      {/* RESET PASSWORD MODAL */}
      <AnimatePresence>{showResetModal && (
        <Modal key="modal-3" onClose={closeResetModal} title="Reset password" preventClose={isSubmittingReset} className="p-5 sm:p-6 max-w-md space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="text-base font-semibold text-foreground">
                  Reset Password: <span className="tabular-nums text-primary">@{showResetModal.username}</span>
                </h3>
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
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-semibold flex items-center space-x-2">
                <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{resetModalError}</span>
              </div>
            )}

            <form onSubmit={handleResetPassword} className="space-y-3.5 text-xs">
              <div>
                <label htmlFor="reset-new-password" className="font-semibold text-slate-700 block mb-1">
                  New Password <span className="text-rose-600">*</span>
                </label>
                <input
                  id="reset-new-password"
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-border-strong focus:outline-hidden focus:border-primary"
                  placeholder="At least 8 characters"
                  disabled={isSubmittingReset}
                />
              </div>

              <div>
                <label htmlFor="reset-confirm-password" className="font-semibold text-slate-700 block mb-1">
                  Confirm New Password <span className="text-rose-600">*</span>
                </label>
                <input
                  id="reset-confirm-password"
                  type="password"
                  required
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-border-strong focus:outline-hidden focus:border-primary"
                  placeholder="Retype new password"
                  disabled={isSubmittingReset}
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-border">
                <button
                  type="button"
                  disabled={isSubmittingReset}
                  onClick={() => {
                    if (!isSubmittingReset) {
                      closeResetModal();
                    }
                  }}
                  className="px-3.5 py-2 rounded-lg border border-slate-300 text-slate-600 font-semibold hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingReset}
                  className="px-4 py-2 rounded-lg bg-rose-700 text-white font-semibold hover:bg-rose-800 transition disabled:opacity-50"
                >
                  {isSubmittingReset ? 'Resetting…' : 'Reset Password'}
                </button>
              </div>
            </form>
          </Modal>
      )}</AnimatePresence>
    </div>
  );
}
