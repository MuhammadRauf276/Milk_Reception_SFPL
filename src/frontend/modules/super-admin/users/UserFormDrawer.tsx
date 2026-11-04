'use client';

import { typePakistaniCnic, typePakistaniMobile } from '@/lib/pakistani-identity';
import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  CREATABLE_ROLES,
  CreatableRole,
  ROLE_ASSIGNMENT_POLICIES,
  getRoleAssignmentPolicy,
} from '@/lib/user-assignment-policy';
import { Combobox } from '@/components/ui/combobox';
import { fetchJson } from '@/lib/query/fetchJson';
import { getErrorMessage } from '@/lib/errors';
import { DrawerActions, FormDrawer, fieldInputClass, fieldLabelClass } from '../shared/FormDrawer';
import type { UserItem, UserSource } from './types';

const ROLE_OPTIONS = CREATABLE_ROLES.map((r) => ({
  value: r,
  label: ROLE_ASSIGNMENT_POLICIES[r].label,
  keywords: `${r} ${ROLE_ASSIGNMENT_POLICIES[r].department}`,
}));

interface Props {
  /** null = create mode */
  user: UserItem | null;
  open: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}

/** Create / edit user bottom sheet. Mount with a `key` per target so state resets. */
export function UserFormDrawer({ user, open, onClose, onSaved }: Props) {
  const isEdit = !!user;
  const initialRole: CreatableRole =
    user && (CREATABLE_ROLES as readonly string[]).includes(user.role) ? (user.role as CreatableRole) : 'SUPER_ADMIN';

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState(user?.email || '');
  const [name, setName] = useState(user?.name || '');
  const [phone, setPhone] = useState(typePakistaniMobile(user?.phone || ''));
  const [cnic, setCnic] = useState(typePakistaniCnic(user?.cnic || ''));
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<CreatableRole>(initialRole);
  const [sourceId, setSourceId] = useState(user?.procurementSourceId || '');
  const [error, setError] = useState<string | null>(null);

  const sourcesQuery = useQuery({
    queryKey: ['super-admin', 'procurement-sources', 'all'],
    queryFn: ({ signal }) => fetchJson<{ sources?: UserSource[] }>('/api/super-admin/procurement-sources', { signal }),
    enabled: open,
  });
  const sources = useMemo(() => sourcesQuery.data?.sources || [], [sourcesQuery.data]);

  const policy = useMemo(() => getRoleAssignmentPolicy(role) || ROLE_ASSIGNMENT_POLICIES.SUPER_ADMIN, [role]);
  const compatible = useMemo(() => {
    if (!policy.requiresSource || !policy.allowedSourceType) return [];
    return sources.filter((s) => s.isActive && s.sourceType === policy.allowedSourceType);
  }, [sources, policy]);
  const sourceOptions = useMemo(
    () => compatible.map((s) => ({ value: s.id, label: `${s.name} · ${s.code}`, keywords: s.code })),
    [compatible]
  );
  // A stale source id (inactive / wrong type) is treated as unselected.
  const effectiveSourceId = compatible.some((s) => s.id === sourceId) ? sourceId : '';

  const handleRoleChange = (newRole: string) => {
    setRole(newRole as CreatableRole);
    const p = getRoleAssignmentPolicy(newRole);
    if (!p?.requiresSource) setSourceId('');
    else {
      const cur = sources.find((s) => s.id === sourceId);
      if (!cur || !cur.isActive || cur.sourceType !== p.allowedSourceType) setSourceId('');
    }
  };

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchJson<{ message?: string }>(isEdit ? `/api/super-admin/users/${user!.id}` : '/api/super-admin/users', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mutation.isPending) return;
    setError(null);

    if (!isEdit) {
      const trimmedUsername = username.trim();
      if (!trimmedUsername) return setError('Username is required.');
      const trimmedEmail = email.trim();
      if (!trimmedEmail) return setError('Email address is required.');
      if (!phone.trim()) return setError('Mobile number is required.');
      if (!cnic.trim()) return setError('CNIC is required.');
      if (!password || password.length < 8) return setError('Password must be at least 8 characters long.');
      if (policy.requiresSource && !effectiveSourceId)
        return setError(`Please select an active ${policy.allowedSourceType} source for ${policy.label}.`);
      mutation.mutate(
        {
          username: trimmedUsername,
          email: trimmedEmail,
          phone: phone.trim(),
          cnic: cnic.trim(),
          name: name.trim(),
          password,
          role,
          procurementSourceId: policy.requiresSource ? effectiveSourceId : null,
        },
        {
          onSuccess: () => onSaved(`User "${trimmedUsername}" created successfully.`),
          onError: (err) => setError(getErrorMessage(err) || 'Failed to create user'),
        }
      );
      return;
    }

    const trimmedEmail = email.trim();
    if (user!.email && !trimmedEmail) return setError('Email address cannot be cleared.');
    if (user!.phone && !phone.trim()) return setError('Mobile number cannot be cleared.');
    if (user!.cnic && !cnic.trim()) return setError('CNIC cannot be cleared.');
    if (policy.requiresSource && !effectiveSourceId)
      return setError(`Please select an active ${policy.allowedSourceType} source for ${policy.label}.`);
    mutation.mutate(
      {
        name: name.trim(),
        role,
        procurementSourceId: policy.requiresSource ? effectiveSourceId : null,
        ...(trimmedEmail ? { email: trimmedEmail } : {}),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(cnic.trim() ? { cnic: cnic.trim() } : {}),
      },
      {
        onSuccess: () => onSaved(`User "${user!.username}" updated successfully.`),
        onError: (err) => setError(getErrorMessage(err) || 'Failed to update user'),
      }
    );
  };

  const busy = mutation.isPending;
  const p = isEdit ? 'edit' : 'create';

  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      busy={busy}
      error={error}
      title={
        isEdit ? (
          <>
            Edit User: <span className="tabular-nums text-primary">@{user!.username}</span>
          </>
        ) : (
          'Create New User Account'
        )
      }
    >
      <form onSubmit={submit} className="space-y-3.5">
        <div className="grid gap-3.5 sm:grid-cols-2">
          <div>
            <label htmlFor={`${p}-username`} className={fieldLabelClass}>
              {isEdit ? (
                'Username'
              ) : (
                <>
                  Username <span className="text-rose-600">*</span>
                </>
              )}
            </label>
            <input
              id={`${p}-username`}
              type="text"
              required={!isEdit}
              readOnly={isEdit}
              value={isEdit ? user!.username : username}
              onChange={(e) => setUsername(e.target.value)}
              className={`${fieldInputClass} ${isEdit ? 'cursor-not-allowed bg-slate-100 tabular-nums text-slate-600' : ''}`}
              placeholder="e.g. john.doe"
              disabled={busy}
            />
          </div>
          <div>
            <label htmlFor={`${p}-email`} className={fieldLabelClass}>
              Email Address{' '}
              {!isEdit ? (
                <span className="text-rose-600">*</span>
              ) : user!.email ? (
                <span className="font-normal text-slate-400">(Cannot be cleared)</span>
              ) : (
                <span className="font-normal text-amber-600">(Required to activate)</span>
              )}
            </label>
            <input
              id={`${p}-email`}
              type="email"
              required={!isEdit}
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={fieldInputClass}
              placeholder={isEdit ? user!.email || 'e.g. user@example.com' : 'e.g. john.doe@example.com'}
              disabled={busy}
            />
          </div>
          <div>
            <label htmlFor={`${p}-name`} className={fieldLabelClass}>
              Full Name
            </label>
            <input
              id={`${p}-name`}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={fieldInputClass}
              placeholder="e.g. John Doe"
              disabled={busy}
            />
          </div>
          <div>
            <label htmlFor={`${p}-phone`} className={fieldLabelClass}>
              Mobile Number {!isEdit && <span className="text-primary">*</span>}
            </label>
            <input
              id={`${p}-phone`}
              type="tel"
              inputMode="tel"
              required={!isEdit}
              value={phone}
              onChange={(e) => setPhone(typePakistaniMobile(e.target.value))}
              className={fieldInputClass}
              placeholder="e.g. 0300-1234567"
              disabled={busy}
            />
          </div>
          <div>
            <label htmlFor={`${p}-cnic`} className={fieldLabelClass}>
              CNIC {!isEdit && <span className="text-primary">*</span>}
            </label>
            <input
              id={`${p}-cnic`}
              type="text"
              inputMode="numeric"
              required={!isEdit}
              value={cnic}
              onChange={(e) => setCnic(typePakistaniCnic(e.target.value))}
              className={fieldInputClass}
              placeholder="e.g. 35201-1234567-1"
              disabled={busy}
            />
          </div>
          {!isEdit && (
            <div>
              <label htmlFor="create-password" className={fieldLabelClass}>
                Password <span className="text-rose-600">*</span>
              </label>
              <input
                id="create-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={fieldInputClass}
                placeholder="At least 8 characters"
                disabled={busy}
              />
            </div>
          )}
        </div>

        <div>
          <label htmlFor={`${p}-role`} className={fieldLabelClass}>
            Canonical Role <span className="text-rose-600">*</span>
          </label>
          <Combobox
            id={`${p}-role`}
            options={ROLE_OPTIONS}
            value={role}
            onValueChange={handleRoleChange}
            searchPlaceholder="Search roles"
            disabled={busy}
          />
        </div>

        {policy.requiresSource && (
          <div>
            <label htmlFor={`${p}-source`} className={fieldLabelClass}>
              Assigned Source <span className="text-rose-600">*</span>
            </label>
            <Combobox
              id={`${p}-source`}
              options={sourceOptions}
              value={effectiveSourceId}
              onValueChange={setSourceId}
              placeholder="Select source"
              searchPlaceholder="Search sources"
              disabled={busy}
            />
            {!sourcesQuery.isLoading && compatible.length === 0 && (
              <p className="mt-1 text-[11px] text-amber-700">
                No active {policy.allowedSourceType} sources found for role {role}.
              </p>
            )}
            <p className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500">
              <span>Source not listed?</span>
              <Link href="/super-admin/procurement-sources" className="shrink-0 font-semibold text-primary hover:underline">
                Add it in Procurement Sources
              </Link>
            </p>
          </div>
        )}

        <div className="space-y-1 rounded-xl border border-border bg-card p-3 text-slate-600">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Assignment Details</div>
          <div className="flex items-center justify-between">
            <span className="font-medium text-slate-500">Department:</span>
            <span className="font-semibold text-slate-800">{policy.department}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-medium text-slate-500">Data Scope:</span>
            <span className="font-semibold text-slate-800">{policy.summaryLabel}</span>
          </div>
        </div>

        <DrawerActions
          busy={busy}
          onCancel={onClose}
          submitLabel={isEdit ? 'Save Changes' : 'Create User'}
          busyLabel={isEdit ? 'Saving…' : 'Creating…'}
        />
      </form>
    </FormDrawer>
  );
}
