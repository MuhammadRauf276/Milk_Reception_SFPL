'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Delete, Lock, UserRound } from 'lucide-react';
import { resolveRoleHome } from '@/lib/role-routing';
import { getDeviceAuthHeaders, getDeviceUid } from '@/frontend/modules/pwa/deviceIdentity';

interface NameCard { id: string; name: string; roleLabel: string; locked: boolean }
type Problem = { kind: 'wrong' | 'locked' | 'other'; text: string };

const NOT_STATION = 'This computer is not set up as a station. Ask the office.';
const PIN_LENGTH = 4;
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
const KEY = 'flex min-h-16 items-center justify-center rounded-xl border-2 border-slate-300 bg-white text-3xl font-semibold text-slate-900 active:bg-slate-200 disabled:opacity-50';

export function StationNameCardLogin() {
  const [cards, setCards] = useState<NameCard[] | null>(null);
  const [notStation, setNotStation] = useState(false);
  const [selected, setSelected] = useState<NameCard | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const headersRef = useRef<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      const headers = await getDeviceAuthHeaders();
      if (!alive) return;
      if (!headers['x-device-key']) {
        setNotStation(true);
        return;
      }
      headersRef.current = headers;
      try {
        const uid = await getDeviceUid();
        const res = await fetch(`/api/auth/station-pin?deviceUid=${encodeURIComponent(uid)}`, { headers });
        const data = await res.json().catch(() => ({}));
        if (!alive) return;
        if (res.status === 403) {
          setNotStation(true);
          return;
        }
        if (!res.ok) throw new Error(data.error || 'Could not load names.');
        setCards(data.users as NameCard[]);
      } catch (err) {
        if (!alive) return;
        setCards([]);
        setProblem({ kind: 'other', text: err instanceof Error ? err.message : 'Could not load names. Check the internet.' });
      }
    })();
    return () => { alive = false; };
  }, []);

  const submit = useCallback(async (card: NameCard, digits: string) => {
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch('/api/auth/station-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headersRef.current },
        body: JSON.stringify({ userId: card.id, pin: digits }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        // Full reload so the workspace boots with the new session.
        window.location.replace(resolveRoleHome(data.user?.role));
        return;
      }
      setPin('');
      if (res.status === 423) setProblem({ kind: 'locked', text: data.error || 'PIN locked. Ask the office.' });
      else if (res.status === 401) setProblem({ kind: 'wrong', text: data.error || 'Wrong PIN.' });
      else setProblem({ kind: 'other', text: data.error || 'Something went wrong. Please try again.' });
    } catch {
      setPin('');
      setProblem({ kind: 'other', text: 'No internet. Please try again.' });
    } finally {
      setBusy(false);
    }
  }, []);

  function press(d: string) {
    if (busy || !selected || problem?.kind === 'locked' || pin.length >= PIN_LENGTH) return;
    const next = pin + d;
    setProblem(null);
    setPin(next);
    if (next.length === PIN_LENGTH) void submit(selected, next);
  }

  function choose(card: NameCard) {
    setSelected(card);
    setPin('');
    setProblem(card.locked ? { kind: 'locked', text: 'PIN locked. Ask the office.' } : null);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-4 py-6">
      <h1 className="text-2xl font-bold text-slate-900">{selected ? `Hello, ${selected.name}` : 'Who are you?'}</h1>

      {notStation ? (
        <p role="alert" className="flex items-center gap-2 rounded-xl border-2 border-rose-300 bg-rose-50 p-4 text-lg text-rose-900">
          <AlertTriangle className="size-6 shrink-0" aria-hidden /> {NOT_STATION}
        </p>
      ) : cards === null ? (
        <p className="text-lg text-slate-700">Loading names…</p>
      ) : !selected ? (
        <>
          {problem ? <ProblemBox problem={problem} /> : null}
          {cards.length === 0 && !problem ? (
            <p className="text-lg text-slate-700">No names are set up on this computer. Ask the office.</p>
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {cards.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => choose(c)}
                    className="flex min-h-14 w-full items-center gap-3 rounded-xl border-2 border-slate-300 bg-white px-4 py-3 text-left active:bg-slate-200"
                  >
                    {c.locked ? <Lock className="size-6 shrink-0 text-rose-700" aria-hidden /> : <UserRound className="size-6 shrink-0 text-slate-700" aria-hidden />}
                    <span className="min-w-0">
                      <span className="block truncate text-xl font-semibold text-slate-900">{c.name}</span>
                      <span className="block truncate text-sm capitalize text-slate-600">{c.locked ? 'PIN locked' : c.roleLabel}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <div className="mx-auto w-full max-w-xs space-y-5">
          <p className="text-center text-lg text-slate-700">Enter your 4-digit PIN</p>
          <div className="flex justify-center gap-4" aria-label={`${pin.length} of ${PIN_LENGTH} digits entered`}>
            {Array.from({ length: PIN_LENGTH }).map((_, i) => (
              <span key={i} className={`size-5 rounded-full border-2 border-slate-500 ${i < pin.length ? 'bg-slate-900' : 'bg-white'}`} />
            ))}
          </div>
          {problem ? <ProblemBox problem={problem} /> : null}
          <div className="grid grid-cols-3 gap-3">
            {DIGITS.map((d) => (
              <button key={d} type="button" className={KEY} disabled={busy} onClick={() => press(d)}>{d}</button>
            ))}
            <button type="button" className={`${KEY} text-lg`} disabled={busy} onClick={() => { setPin(''); setProblem(null); }}>Clear</button>
            <button type="button" className={KEY} disabled={busy} onClick={() => press('0')}>0</button>
            <button type="button" className={KEY} disabled={busy} aria-label="Back" onClick={() => setPin((p) => p.slice(0, -1))}>
              <Delete className="size-7" aria-hidden />
            </button>
          </div>
          {busy ? <p className="text-center text-slate-700">Checking…</p> : null}
          <button
            type="button"
            className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl border-2 border-slate-300 bg-white text-lg font-medium text-slate-900"
            disabled={busy}
            onClick={() => { setSelected(null); setPin(''); setProblem(null); }}
          >
            <ArrowLeft className="size-5" aria-hidden /> Not me
          </button>
        </div>
      )}
    </main>
  );
}

function ProblemBox({ problem }: { problem: Problem }) {
  const locked = problem.kind === 'locked';
  return (
    <p
      role="alert"
      className={`flex items-center gap-2 rounded-xl border-2 p-3 text-lg font-medium ${
        locked ? 'border-rose-400 bg-rose-50 text-rose-900' : 'border-amber-400 bg-amber-50 text-amber-900'
      }`}
    >
      {locked ? <Lock className="size-6 shrink-0" aria-hidden /> : <AlertTriangle className="size-6 shrink-0" aria-hidden />}
      {problem.text}
    </p>
  );
}
