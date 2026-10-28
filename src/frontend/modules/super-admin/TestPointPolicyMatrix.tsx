'use client';

import { InfoTip } from '@/components/ui/info-tip';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Camera, CheckCircle2, CircleSlash, Lock, MinusCircle, Save, ShieldCheck, X } from 'lucide-react';
import { TEST_POINT_LABELS } from '@/types/test-point-policy';
import type { TestPointCode, TestPointPolicyCell } from '@/types/test-point-policy';

type Field = 'testMode' | 'ruleMode' | 'photoMode';
type Tone = 'good' | 'warn' | 'off';

interface Option {
  value: string;
  label: string;
  tone: Tone;
  icon: React.ComponentType<{ className?: string }>;
}

const FIELD_OPTIONS: Record<Field, { title: string; options: Option[] }> = {
  testMode: {
    title: 'Test',
    options: [
      { value: 'COMPULSORY', label: 'Compulsory', tone: 'good', icon: CheckCircle2 },
      { value: 'OPTIONAL', label: 'Optional', tone: 'warn', icon: MinusCircle },
      { value: 'OFF', label: 'Off', tone: 'off', icon: CircleSlash },
    ],
  },
  ruleMode: {
    title: 'Rule',
    options: [
      { value: 'APPLY', label: 'Apply', tone: 'good', icon: ShieldCheck },
      { value: 'WARN', label: 'Warn', tone: 'warn', icon: AlertTriangle },
    ],
  },
  photoMode: {
    title: 'Photo',
    options: [
      { value: 'REQUIRED', label: 'Required', tone: 'good', icon: Camera },
      { value: 'OPTIONAL', label: 'Optional', tone: 'warn', icon: MinusCircle },
      { value: 'NONE', label: 'None', tone: 'off', icon: CircleSlash },
    ],
  },
};

const TONE_ACTIVE: Record<Tone, string> = {
  good: 'bg-emerald-600 text-white border-emerald-700',
  warn: 'bg-amber-500 text-slate-900 border-amber-600',
  off: 'bg-slate-600 text-white border-slate-700',
};

const FIELDS: Field[] = ['testMode', 'ruleMode', 'photoMode'];

const cellKey = (labTestId: string, point: string) => `${labTestId}|${point}`;

export function TestPointPolicyMatrix() {
  const [cells, setCells] = useState<TestPointPolicyCell[]>([]);
  const [points, setPoints] = useState<TestPointCode[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [edits, setEdits] = useState<Record<string, Partial<Record<Field, string>>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showReason, setShowReason] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/super-admin/test-point-policies', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load the test matrix.');
      setCells(data.cells);
      setPoints(data.points);
      setCanEdit(Boolean(data.canEdit));
      setEdits({});
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the test matrix.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const byKey = useMemo(() => new Map(cells.map((c) => [cellKey(c.labTestId, c.point), c])), [cells]);
  const tests = useMemo(() => {
    const seen = new Set<string>();
    const list: Array<{ id: string; code: string; name: string }> = [];
    for (const c of cells) {
      if (seen.has(c.labTestId)) continue;
      seen.add(c.labTestId);
      list.push({ id: c.labTestId, code: c.testCode, name: c.testName });
    }
    return list;
  }, [cells]);

  const valueOf = (c: TestPointPolicyCell, f: Field): string => edits[cellKey(c.labTestId, c.point)]?.[f] ?? c[f];
  const isChanged = (c: TestPointPolicyCell) => FIELDS.some((f) => valueOf(c, f) !== c[f]);
  const changedCells = cells.filter(isChanged);

  const setField = (c: TestPointPolicyCell, f: Field, value: string) => {
    if (!canEdit) return;
    setNotice(null);
    setEdits((prev) => {
      const key = cellKey(c.labTestId, c.point);
      const next = { ...(prev[key] ?? {}), [f]: value };
      if (next[f] === c[f]) delete next[f];
      const copy = { ...prev };
      if (Object.keys(next).length === 0) delete copy[key];
      else copy[key] = next;
      return copy;
    });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const changes = changedCells.map((c) => ({
        labTestId: c.labTestId,
        point: c.point,
        testMode: valueOf(c, 'testMode'),
        ruleMode: valueOf(c, 'ruleMode'),
        photoMode: valueOf(c, 'photoMode'),
      }));
      const res = await fetch('/api/super-admin/test-point-policies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim(), changes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save.');
      setShowReason(false);
      setReason('');
      setNotice(`Saved. ${data.applied} cell(s) changed.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-8 text-sm font-semibold text-slate-600">Loading test matrix…</div>;

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center text-xl font-bold text-slate-900">Test Matrix<InfoTip text="What is tested, how rules act and which photos are needed at each point." /></h1>
        </div>
        {canEdit ? (
          <button
            type="button"
            disabled={changedCells.length === 0}
            onClick={() => setShowReason(true)}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-emerald-700 px-5 text-sm font-bold text-white disabled:opacity-40"
          >
            <Save className="h-4 w-4" /> Save changes ({changedCells.length})
          </button>
        ) : (
          <span className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-slate-100 px-4 text-sm font-semibold text-slate-700">
            <Lock className="h-4 w-4" /> View only
          </span>
        )}
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm font-semibold text-rose-800">
          <AlertTriangle className="h-4 w-4" /> {error}
        </div>
      )}
      {notice && (
        <div role="status" className="flex items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm font-semibold text-emerald-800">
          <CheckCircle2 className="h-4 w-4" /> {notice}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="min-w-full border-collapse text-left text-xs">
          <thead>
            <tr className="bg-slate-50">
              <th className="sticky left-0 z-10 min-w-[160px] bg-slate-50 p-3 text-sm font-bold text-slate-800">Test</th>
              {points.map((p) => (
                <th key={p} className="min-w-[210px] p-3 text-sm font-bold text-slate-800">
                  {TEST_POINT_LABELS[p]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tests.map((t) => (
              <tr key={t.id} className="border-t border-slate-200 align-top">
                <th scope="row" className="sticky left-0 z-10 bg-white p-3 text-sm font-semibold text-slate-900">
                  {t.name}
                  <div className="text-[11px] font-normal text-slate-500">{t.code}</div>
                </th>
                {points.map((p) => {
                  const c = byKey.get(cellKey(t.id, p));
                  if (!c) return <td key={p} className="p-2" />;
                  const changed = isChanged(c);
                  return (
                    <td key={p} className={`p-2 ${changed ? 'bg-amber-50 ring-2 ring-inset ring-amber-400' : ''}`}>
                      <div className="space-y-2">
                        {FIELDS.map((f) => (
                          <div key={f} role="radiogroup" aria-label={`${t.name} ${TEST_POINT_LABELS[p]} ${FIELD_OPTIONS[f].title}`}>
                            <div className="mb-0.5 text-[11px] font-bold uppercase text-slate-500">{FIELD_OPTIONS[f].title}</div>
                            <div className="flex overflow-hidden rounded-lg border border-slate-300">
                              {FIELD_OPTIONS[f].options.map((o) => {
                                const active = valueOf(c, f) === o.value;
                                const Icon = o.icon;
                                return (
                                  <button
                                    key={o.value}
                                    type="button"
                                    role="radio"
                                    aria-checked={active}
                                    disabled={!canEdit}
                                    onClick={() => setField(c, f, o.value)}
                                    className={`flex min-h-[44px] flex-1 items-center justify-center gap-1 border-l border-slate-300 px-1 text-[11px] font-bold first:border-l-0 ${
                                      active ? TONE_ACTIVE[o.tone] : 'bg-white text-slate-600'
                                    } ${canEdit ? '' : 'cursor-default'}`}
                                  >
                                    <Icon className="h-3.5 w-3.5 shrink-0" />
                                    {o.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                        <div className="text-[10px] text-slate-500">
                          {c.source === 'DEFAULT' ? 'Default (not saved yet)' : `Version ${c.version}`}
                        </div>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showReason && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Reason for change">
          <div className="w-full max-w-md space-y-3 rounded-xl bg-card p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Why are you changing this?</h2>
              <button type="button" onClick={() => setShowReason(false)} aria-label="Close" className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-sm text-slate-600">{changedCells.length} cell(s) will change. New records use the new rules; old records keep theirs.</p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Write the reason (at least 5 letters)"
              className="w-full rounded-lg border border-slate-300 p-3 text-sm"
            />
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowReason(false)} className="min-h-[44px] flex-1 rounded-lg border border-slate-300 text-sm font-bold text-slate-700">
                Cancel
              </button>
              <button
                type="button"
                disabled={saving || reason.trim().length < 5}
                onClick={() => void save()}
                className="min-h-[44px] flex-1 rounded-lg bg-emerald-700 text-sm font-bold text-white disabled:opacity-40"
              >
                {saving ? 'Saving…' : 'Confirm and save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
