'use client';

import React, { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Combobox } from '@/components/ui/combobox';
import { Button } from '@/components/ui/button';
import { fetchJson } from '@/lib/query/fetchJson';
import { getErrorMessage } from '@/lib/errors';
import { FormDrawer } from '../shared/FormDrawer';
import type { UnassignedTestItem } from './types';

interface Props {
  stage: string;
  stageLabel: string;
  tests: UnassignedTestItem[];
  onClose: () => void;
  onAssigned: () => void;
}

/** Pick a master-catalogue test (searchable) and assign it to the current stage. */
export function AssignTestDrawer({ stage, stageLabel, tests, onClose, onAssigned }: Props) {
  const [testId, setTestId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const options = useMemo(
    () =>
      tests.map((t) => ({
        value: t.id,
        label: `${t.testName} (${t.testCode}) · ${t.resultType}${t.unit ? ` [${t.unit}]` : ''}`,
        keywords: `${t.testCode} ${t.resultType}`,
      })),
    [tests]
  );

  const mutation = useMutation({
    mutationFn: () =>
      fetchJson('/api/super-admin/stage-policies-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'assignTest', testingPoint: stage, labTestId: testId }),
      }),
    onSuccess: onAssigned,
    onError: (err) => setError(getErrorMessage(err) || 'Error assigning test.'),
  });
  const busy = mutation.isPending;

  return (
    <FormDrawer open onClose={onClose} busy={busy} error={error} title={`Assign Test to ${stageLabel}`}>
      
      {tests.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-4 text-center font-semibold text-slate-500">
          All assigned
        </div>
      ) : (
        <div>
          <label className="mb-1.5 block font-bold text-slate-700">Test</label>
          <Combobox
            options={options}
            value={testId}
            onValueChange={setTestId}
            placeholder="Choose a test to assign"
            searchPlaceholder="Search tests by name or code"
            disabled={busy}
          />
        </div>
      )}
      <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
        <Button type="button" variant="outline" className="h-11 px-4" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          className="h-11 px-5"
          disabled={!testId || busy}
          onClick={() => {
            setError(null);
            mutation.mutate();
          }}
        >
          {busy ? 'Assigning…' : 'Assign to Stage'}
        </Button>
      </div>
    </FormDrawer>
  );
}
