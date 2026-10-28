'use client';

import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fetchJson } from '@/lib/query/fetchJson';
import { getErrorMessage } from '@/lib/errors';
import { FormDrawer } from '../shared/FormDrawer';
import type { UserItem } from './types';

interface Props {
  user: UserItem;
  targetStatus: boolean;
  open: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}

export function UserStatusDrawer({ user, targetStatus, open, onClose, onSaved }: Props) {
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () =>
      fetchJson(`/api/super-admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: targetStatus }),
      }),
    onSuccess: () => onSaved(`User "${user.username}" ${targetStatus ? 'activated' : 'deactivated'} successfully.`),
    onError: (err) => setError(getErrorMessage(err) || 'Failed to update user status'),
  });
  const busy = mutation.isPending;

  return (
    <FormDrawer open={open} onClose={onClose} busy={busy} error={error} title={`Confirm ${targetStatus ? 'Activation' : 'Deactivation'}`}>
      <p className="text-xs text-slate-500">
        Target Account: <span className="font-semibold tabular-nums text-slate-800">@{user.username}</span>
      </p>
      <div className="space-y-2 rounded-xl border border-border bg-card p-3.5">
        <div className="flex justify-between">
          <span className="font-medium text-slate-500">Current Status:</span>
          <span className={`font-semibold ${user.isActive ? 'text-emerald-700' : 'text-rose-700'}`}>
            {user.isActive ? 'Active' : 'Deactivated'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="font-medium text-slate-500">Requested Status:</span>
          <span className={`font-semibold ${targetStatus ? 'text-emerald-700' : 'text-rose-700'}`}>
            {targetStatus ? 'Active' : 'Deactivated'}
          </span>
        </div>
      </div>
      {!targetStatus ? (
        <p className="rounded-xl border border-border bg-card p-3 font-medium text-rose-700">
          Access removed immediately.
        </p>
      ) : (
        <p className="font-medium text-slate-600">Access restored.</p>
      )}
      {targetStatus && !user.email && (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-3 text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
          <span>This account has no email set. An email is required before activation. Please edit the account to provide an email first.</span>
        </div>
      )}
      <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
        <Button type="button" variant="outline" className="h-11 px-4" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          variant={targetStatus ? 'default' : 'destructive'}
          className="h-11 px-5"
          disabled={busy}
          onClick={() => {
            setError(null);
            mutation.mutate();
          }}
        >
          {busy ? 'Updating…' : targetStatus ? 'Confirm Activation' : 'Confirm Deactivation'}
        </Button>
      </div>
    </FormDrawer>
  );
}
