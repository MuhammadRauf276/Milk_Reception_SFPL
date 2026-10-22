'use client';

import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';
import { getErrorMessage } from '@/lib/errors';
import { DrawerActions, FormDrawer, fieldInputClass, fieldLabelClass } from '../shared/FormDrawer';
import type { UserItem } from './types';

interface Props {
  user: UserItem;
  open: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}

export function UserResetPasswordDrawer({ user, open, onClose, onSaved }: Props) {
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () =>
      fetchJson<{ message?: string }>(`/api/super-admin/users/${user.id}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPassword }),
      }),
    onSuccess: (data) => onSaved(data.message || `Password for "${user.username}" reset successfully.`),
    onError: (err) => setError(getErrorMessage(err) || 'Failed to reset password'),
  });
  const busy = mutation.isPending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (!newPassword || newPassword.length < 8) return setError('Password must be at least 8 characters long.');
    if (newPassword !== confirm) return setError('Passwords do not match. Please retype to confirm.');
    mutation.mutate();
  };

  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      busy={busy}
      error={error}
      title={
        <>
          Reset Password: <span className="tabular-nums text-primary">@{user.username}</span>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-3.5">
        <div>
          <label htmlFor="reset-new-password" className={fieldLabelClass}>
            New Password <span className="text-rose-600">*</span>
          </label>
          <input
            id="reset-new-password"
            type="password"
            required
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className={fieldInputClass}
            placeholder="At least 8 characters"
            disabled={busy}
          />
        </div>
        <div>
          <label htmlFor="reset-confirm-password" className={fieldLabelClass}>
            Confirm New Password <span className="text-rose-600">*</span>
          </label>
          <input
            id="reset-confirm-password"
            type="password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={fieldInputClass}
            placeholder="Retype new password"
            disabled={busy}
          />
        </div>
        <DrawerActions busy={busy} onCancel={onClose} submitLabel="Reset Password" busyLabel="Resetting…" danger />
      </form>
    </FormDrawer>
  );
}
