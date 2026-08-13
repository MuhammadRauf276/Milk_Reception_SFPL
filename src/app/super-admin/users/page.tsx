'use client';

import React, { useEffect, useState } from 'react';
import { Users, Plus, KeyRound, ShieldAlert, CheckCircle2, XCircle, RefreshCw } from 'lucide-react';

interface Source {
  id: string;
  code: string;
  name: string;
  sourceType: string;
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
  const [showResetModal, setShowResetModal] = useState<UserItem | null>(null);
  const [showEditModal, setShowEditModal] = useState<UserItem | null>(null);

  // Form states
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('SUPER_ADMIN');
  const [department, setDepartment] = useState('');
  const [scopeType, setScopeType] = useState('SYSTEM');
  const [procurementSourceId, setProcurementSourceId] = useState('');

  // Password Reset state
  const [newPassword, setNewPassword] = useState('');

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

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await fetch('/api/super-admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          name,
          password,
          role,
          department,
          scopeType,
          procurementSourceId: procurementSourceId || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create user');
      }

      setSuccessMsg(`User "${username}" created successfully.`);
      setShowCreateModal(false);
      resetForm();
      loadData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleToggleActive = async (user: UserItem) => {
    setError(null);
    setSuccessMsg(null);
    const newStatus = !user.isActive;

    try {
      const res = await fetch(`/api/super-admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: newStatus }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update user status');
      }

      setSuccessMsg(`User "${user.username}" ${newStatus ? 'activated' : 'deactivated'} successfully.`);
      loadData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showResetModal) return;
    setError(null);
    setSuccessMsg(null);

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

      setSuccessMsg(data.message || 'Password reset successfully.');
      setShowResetModal(null);
      setNewPassword('');
    } catch (err: any) {
      setError(err.message);
    }
  };

  const resetForm = () => {
    setUsername('');
    setName('');
    setPassword('');
    setRole('SUPER_ADMIN');
    setDepartment('');
    setScopeType('SYSTEM');
    setProcurementSourceId('');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-[#111311]">Users & Access Management</h1>
          <p className="text-xs font-medium text-slate-500 mt-1">
            Database-backed user administration with bcrypt password hashing, data scopes, and Last Super Admin protection.
          </p>
        </div>
        <button
          onClick={() => {
            resetForm();
            setShowCreateModal(true);
          }}
          className="flex items-center space-x-2 px-4 py-2 bg-[#1E3A8A] text-white rounded-xl text-xs font-bold shadow-sm hover:bg-blue-900 transition"
        >
          <Plus className="w-4 h-4" />
          <span>Create New User</span>
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

      {/* USERS TABLE */}
      <div className="bg-white rounded-xl border border-[#EAE4D5]/80 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
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
                users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="p-3">
                      <div className="font-bold text-[#111311]">{u.name}</div>
                      <div className="font-mono text-[10px] text-slate-500">@{u.username}</div>
                    </td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold ${
                        u.role === 'SUPER_ADMIN' ? 'bg-indigo-100 text-indigo-900' : 'bg-slate-100 text-slate-800'
                      }`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="p-3 text-slate-600">{u.department}</td>
                    <td className="p-3">
                      <div className="font-bold text-slate-700">{u.scopeType}</div>
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
                    <td className="p-3 text-right space-x-2">
                      <button
                        onClick={() => setShowResetModal(u)}
                        className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[11px] font-bold transition"
                        title="Reset Password"
                      >
                        <KeyRound className="w-3.5 h-3.5 inline mr-1" />
                        Reset Pass
                      </button>
                      <button
                        onClick={() => handleToggleActive(u)}
                        className={`px-2 py-1 rounded text-[11px] font-bold transition ${
                          u.isActive
                            ? 'bg-rose-50 hover:bg-rose-100 text-rose-700'
                            : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700'
                        }`}
                      >
                        {u.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* CREATE USER MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl border border-[#EAE4D5] p-6 w-full max-w-md space-y-4 shadow-xl">
            <h3 className="text-base font-extrabold text-[#111311]">Create New User Account</h3>

            <form onSubmit={handleCreateUser} className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Username *</label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full p-2 rounded-lg border border-[#C4B9A3] focus:outline-none focus:border-[#1E3A8A]"
                  placeholder="e.g. john.doe"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Full Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full p-2 rounded-lg border border-[#C4B9A3] focus:outline-none focus:border-[#1E3A8A]"
                  placeholder="e.g. John Doe"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Password *</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full p-2 rounded-lg border border-[#C4B9A3] focus:outline-none focus:border-[#1E3A8A]"
                  placeholder="At least 4 characters"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Canonical Role *</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full p-2 rounded-lg border border-[#C4B9A3] focus:outline-none focus:border-[#1E3A8A]"
                >
                  <option value="SUPER_ADMIN">SUPER_ADMIN (Super Admin)</option>
                  <option value="EXECUTIVE_MANAGEMENT">EXECUTIVE_MANAGEMENT (Plant Executive)</option>
                  <option value="ZMCC_MANAGER">ZMCC_MANAGER (ZMCC Source Manager)</option>
                  <option value="CONTRACTOR_MANAGER">CONTRACTOR_MANAGER (Contractor Source Manager)</option>
                  <option value="MPD_Operator">MPD_Operator (MPD Field Operator)</option>
                  <option value="Security_Operator">Security_Operator (Gate Security)</option>
                  <option value="QA_Operator">QA_Operator (QA Chemist)</option>
                  <option value="WEIGHBRIDGE_OPERATOR">WEIGHBRIDGE_OPERATOR (Weighbridge Operator)</option>
                  <option value="Production_Operator">Production_Operator (Silo Operator)</option>
                  <option value="Correction_Officer">Correction_Officer (Data Correction Officer)</option>
                </select>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Department</label>
                <input
                  type="text"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  className="w-full p-2 rounded-lg border border-[#C4B9A3] focus:outline-none focus:border-[#1E3A8A]"
                  placeholder="e.g. QA Management"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Data Scope Level</label>
                <select
                  value={scopeType}
                  onChange={(e) => setScopeType(e.target.value)}
                  className="w-full p-2 rounded-lg border border-[#C4B9A3] focus:outline-none focus:border-[#1E3A8A]"
                >
                  <option value="SYSTEM">SYSTEM (Super Admin Master)</option>
                  <option value="ALL">ALL (Complete Plant Access)</option>
                  <option value="DEPARTMENT">DEPARTMENT (Department Restricted)</option>
                  <option value="PROCUREMENT_SOURCE">PROCUREMENT_SOURCE (Single Source Restricted)</option>
                </select>
              </div>

              {scopeType === 'PROCUREMENT_SOURCE' && (
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Assigned Procurement Source *</label>
                  <select
                    value={procurementSourceId}
                    onChange={(e) => setProcurementSourceId(e.target.value)}
                    className="w-full p-2 rounded-lg border border-[#C4B9A3] focus:outline-none focus:border-[#1E3A8A]"
                  >
                    <option value="">Select Procurement Source...</option>
                    {sources.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.sourceType} - {s.code})
                      </option>
                    ))}
                  </select>
                </div>
              )}

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
                  Create User
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RESET PASSWORD MODAL */}
      {showResetModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl border border-[#EAE4D5] p-6 w-full max-w-md space-y-4 shadow-xl">
            <h3 className="text-base font-extrabold text-[#111311]">
              Reset Password for "{showResetModal.username}"
            </h3>
            <p className="text-xs text-slate-500">
              New password will be hashed with bcrypt. Password will NOT be stored in AuditLog.
            </p>

            <form onSubmit={handleResetPassword} className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">New Password *</label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full p-2 rounded-lg border border-[#C4B9A3] focus:outline-none focus:border-[#1E3A8A]"
                  placeholder="Enter new password"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-[#EAE4D5]">
                <button
                  type="button"
                  onClick={() => setShowResetModal(null)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-rose-700 text-white font-bold hover:bg-rose-800"
                >
                  Reset Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
