'use client';

import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getErrorMessage } from '@/lib/errors';
import { MotSheet, sheetInputClass, sheetLabelClass, sheetPrimaryButtonClass } from '../MotSheet';
import { SheetError } from './SheetError';
import { sendJson } from './mutationUtils';
import { MOT_TAB_DATA_KEY, type MotProfileItem } from './types';

interface Props {
  editing: MotProfileItem | null;
  /** ZMCC to send with the request (already resolved for central vs. station roles). */
  defaultZmccId: string | null;
  isCentralRole: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}

export function ProfileSheet({ editing, defaultZmccId, isCentralRole, onClose, onDone }: Props) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    mot_code: editing?.mot_code ?? '',
    name: editing?.name ?? '',
    phone_number: editing?.phone_number ?? '',
    cnic: editing?.cnic ?? '',
    user_id: editing?.user_id ?? '',
    zmcc_id: editing?.zmcc_id ?? defaultZmccId ?? '',
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      sendJson(
        editing ? `/api/zmcc/mot/profiles/${editing.id}` : '/api/zmcc/mot/profiles',
        editing ? 'PATCH' : 'POST',
        { ...form, zmcc_id: isCentralRole ? form.zmcc_id || defaultZmccId : defaultZmccId },
        'Failed to save MC Profile.'
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MOT_TAB_DATA_KEY });
      onDone(editing ? 'MC Profile updated successfully.' : 'MC Profile created successfully.');
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const field = (key: 'mot_code' | 'name' | 'phone_number' | 'cnic', label: string, placeholder: string) => (
    <div>
      <label htmlFor={`profile-${key}`} className={sheetLabelClass}>{label} *</label>
      <input
        id={`profile-${key}`}
        type="text"
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        placeholder={placeholder}
        className={sheetInputClass}
        required
      />
    </div>
  );

  return (
    <MotSheet title={editing ? 'Edit Mobile Tester Profile' : 'New Mobile Tester Profile'} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          saveMutation.mutate();
        }}
        className="space-y-3"
      >
        {!editing && field('mot_code', 'MC Code', 'e.g. MOT-001')}
        {field('name', 'Mobile Tester Full Name', 'e.g. Full Name')}
        {field('phone_number', 'Phone Number', '0300-1234567')}
        {field('cnic', 'CNIC Number', '35201-1234567-1')}
        <SheetError message={error} />
        <button type="submit" disabled={saveMutation.isPending} className={sheetPrimaryButtonClass}>
          {saveMutation.isPending ? 'Saving…' : 'Save Profile'}
        </button>
      </form>
    </MotSheet>
  );
}
