'use client';

import React, { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { AlertTriangle, Ban, CheckCircle2, Clock, KeyRound, Plus, ScrollText, Smartphone, Undo2, UserPlus } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { fetchJson } from '@/lib/fetch-json';
import { getErrorMessage } from '@/lib/errors';

type Status = 'PENDING' | 'ACTIVE' | 'BLOCKED' | 'RELEASED';

interface DeviceItem {
  id: string;
  deviceUid: string;
  label: string | null;
  status: Status;
  isSharedStation: boolean;
  assignedUserName: string | null;
  procurementSourceName: string | null;
  blockReason: string | null;
  lastSeenAt: string | null;
  lastAppVersion: string | null;
  lastUnsentCount: number;
}

interface UserOption { id: string; name: string; role: string }
interface SourceOption { id: string; name: string; sourceType: string }
interface DiaryItem { id: string; eventType: string; performedAsRole: string | null; occurredAt: string; payload: unknown }

const STATUS_VIEW: Record<Status, { word: string; icon: React.ReactNode; cls: string }> = {
  ACTIVE: { word: 'Working', icon: <CheckCircle2 className="size-4" aria-hidden />, cls: 'bg-emerald-100 text-emerald-900 border-emerald-300' },
  PENDING: { word: 'Waiting', icon: <Clock className="size-4" aria-hidden />, cls: 'bg-amber-100 text-amber-900 border-amber-300' },
  BLOCKED: { word: 'Blocked', icon: <Ban className="size-4" aria-hidden />, cls: 'bg-red-100 text-red-900 border-red-300' },
  RELEASED: { word: 'Back in office', icon: <Undo2 className="size-4" aria-hidden />, cls: 'bg-slate-100 text-slate-800 border-slate-300' },
};

const EVENT_WORDS: Record<string, string> = {
  REGISTERED: 'Phone registered',
  ASSIGNED: 'Given to a user',
  RELEASED: 'Phone released',
  BLOCKED: 'Phone blocked',
  KEY_ROTATED: 'New key made',
  LOGIN: 'User logged in',
};

const BTN = 'min-h-11 px-4';
const FIELD = 'min-h-11 w-full rounded-md border border-input bg-card px-3 text-sm';

function formatTime(iso: string | null): string {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Karachi', dateStyle: 'medium', timeStyle: 'short' });
}

function StatusPill({ status }: { status: Status }) {
  const v = STATUS_VIEW[status] ?? STATUS_VIEW.PENDING;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium ${v.cls}`}>
      {v.icon}
      {v.word}
    </span>
  );
}

function KeyQr({ deviceUid, syncKey }: { deviceUid: string; syncKey: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(JSON.stringify({ deviceUid, key: syncKey }), { width: 240, margin: 2 })
      .then((url) => { if (alive) setSrc(url); })
      .catch(() => { if (alive) setSrc(null); });
    return () => { alive = false; };
  }, [deviceUid, syncKey]);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Scan this code with the phone. It is shown only now. Close it only after the phone is set up.</p>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="QR code for phone setup" width={240} height={240} className="mx-auto rounded-md border bg-white" />
      ) : null}
      <div className="rounded-md border bg-muted p-3 text-xs break-all">
        <div><strong>Phone ID:</strong> {deviceUid}</div>
        <div><strong>Key:</strong> {syncKey}</div>
      </div>
    </div>
  );
}

type Dialog =
  | { kind: 'register' }
  | { kind: 'assign'; device: DeviceItem }
  | { kind: 'release'; device: DeviceItem }
  | { kind: 'block'; device: DeviceItem }
  | { kind: 'key'; device: DeviceItem }
  | { kind: 'diary'; device: DeviceItem }
  | { kind: 'shown-key'; deviceUid: string; syncKey: string };

const DIALOG_TITLES: Record<Dialog['kind'], string> = {
  register: 'Register phone',
  assign: 'Give phone to a user',
  release: 'Release phone',
  block: 'Block phone',
  key: 'Make a new key',
  diary: 'Phone diary',
  'shown-key': 'Phone key',
};

export function DevicesWorkspace() {
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [sources, setSources] = useState<SourceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [diary, setDiary] = useState<DiaryItem[]>([]);

  const [formUid, setFormUid] = useState('');
  const [formLabel, setFormLabel] = useState('');
  const [formShared, setFormShared] = useState(false);
  const [formSource, setFormSource] = useState('');
  const [formUser, setFormUser] = useState('');
  const [formReason, setFormReason] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await fetchJson<{ devices: DeviceItem[]; users: UserOption[]; sources: SourceOption[] }>('/api/devices');
      setDevices(data.devices);
      setUsers(data.users);
      setSources(data.sources);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  function open(next: Dialog) {
    setDialogError(null);
    setFormReason('');
    setFormUser('');
    if (next.kind === 'register') {
      setFormUid(typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : '');
      setFormLabel('');
      setFormShared(false);
      setFormSource('');
    }
    setDialog(next);
    if (next.kind === 'diary') {
      setDiary([]);
      fetchJson<{ entries: DiaryItem[] }>(`/api/devices/${next.device.id}/diary?limit=100`)
        .then((d) => setDiary(d.entries))
        .catch((err) => setDialogError(getErrorMessage(err)));
    }
  }

  async function run(request: () => Promise<{ syncKey?: string }>, deviceUid?: string) {
    setBusy(true);
    setDialogError(null);
    try {
      const result = await request();
      await load();
      setDialog(result.syncKey && deviceUid ? { kind: 'shown-key', deviceUid, syncKey: result.syncKey } : null);
    } catch (err) {
      setDialogError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const patch = (id: string, body: Record<string, unknown>) =>
    fetchJson<{ syncKey?: string }>(`/api/devices/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Phones"
        description="Register field phones, give them to users, and see what each phone did."
        actions={
          <Button className={BTN} onClick={() => open({ kind: 'register' })}>
            <Plus aria-hidden /> Register phone
          </Button>
        }
      />

      {error ? (
        <div role="alert" className="flex items-center gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          <AlertTriangle className="size-4" aria-hidden /> {error}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading phones...</p>
      ) : devices.length === 0 ? (
        <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">No phones yet. Tap Register phone to add one.</p>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {devices.map((d) => (
            <li key={d.id} className="space-y-3 rounded-lg border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-semibold">
                    <Smartphone className="size-4 shrink-0" aria-hidden />
                    <span className="truncate">{d.label || d.deviceUid}</span>
                  </div>
                  <div className="text-xs text-muted-foreground break-all">{d.deviceUid}</div>
                </div>
                <StatusPill status={d.status} />
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">User</dt>
                <dd>{d.assignedUserName ?? (d.isSharedStation ? 'Shared station' : 'Nobody')}</dd>
                <dt className="text-muted-foreground">ZMCC</dt>
                <dd>{d.procurementSourceName ?? '-'}</dd>
                <dt className="text-muted-foreground">Last seen</dt>
                <dd>{formatTime(d.lastSeenAt)}</dd>
                <dt className="text-muted-foreground">App version</dt>
                <dd>{d.lastAppVersion ?? '-'}</dd>
                <dt className="text-muted-foreground">Not sent yet</dt>
                <dd>{d.lastUnsentCount}</dd>
              </dl>
              {d.status === 'BLOCKED' && d.blockReason ? <p className="text-sm text-red-900">Reason: {d.blockReason}</p> : null}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" className={BTN} disabled={d.status === 'BLOCKED'} onClick={() => open({ kind: 'assign', device: d })}>
                  <UserPlus aria-hidden /> Give to user
                </Button>
                <Button variant="outline" className={BTN} onClick={() => open({ kind: 'release', device: d })}>
                  <Undo2 aria-hidden /> Release phone
                </Button>
                <Button variant="outline" className={BTN} disabled={d.status === 'BLOCKED'} onClick={() => open({ kind: 'key', device: d })}>
                  <KeyRound aria-hidden /> Show key again
                </Button>
                <Button variant="outline" className={BTN} onClick={() => open({ kind: 'diary', device: d })}>
                  <ScrollText aria-hidden /> Diary
                </Button>
                <Button variant="destructive" className={BTN} disabled={d.status === 'BLOCKED'} onClick={() => open({ kind: 'block', device: d })}>
                  <Ban aria-hidden /> Block
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {dialog ? (
        <Modal
          onClose={() => { if (!busy) setDialog(null); }}
          preventClose={busy}
          showHeader
          size={dialog.kind === 'diary' ? 'lg' : 'md'}
          title={DIALOG_TITLES[dialog.kind]}
        >
          <div className="space-y-4 p-4 pt-0">
            {dialogError ? <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-900">{dialogError}</p> : null}

            {dialog.kind === 'register' ? (
              <>
                <label className="block space-y-1 text-sm font-medium">Phone ID
                  <input className={FIELD} value={formUid} onChange={(e) => setFormUid(e.target.value)} maxLength={64} />
                </label>
                <label className="block space-y-1 text-sm font-medium">Name of phone
                  <input className={FIELD} value={formLabel} onChange={(e) => setFormLabel(e.target.value)} maxLength={150} placeholder="For example: Gujrat MOT phone 1" />
                </label>
                <label className="block space-y-1 text-sm font-medium">ZMCC (if any)
                  <select className={FIELD} value={formSource} onChange={(e) => setFormSource(e.target.value)}>
                    <option value="">No ZMCC</option>
                    {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
                <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
                  <input type="checkbox" className="size-5" checked={formShared} onChange={(e) => setFormShared(e.target.checked)} />
                  Shared station computer
                </label>
                <Button
                  className={BTN}
                  disabled={busy || !formUid.trim() || !formLabel.trim()}
                  onClick={() =>
                    run(
                      () =>
                        fetchJson<{ syncKey: string }>('/api/devices', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            deviceUid: formUid.trim(),
                            label: formLabel.trim(),
                            isSharedStation: formShared,
                            procurementSourceId: formSource || null,
                          }),
                        }),
                      formUid.trim()
                    )
                  }
                >
                  Register
                </Button>
              </>
            ) : null}

            {dialog.kind === 'assign' ? (
              <>
                <label className="block space-y-1 text-sm font-medium">User
                  <select className={FIELD} value={formUser} onChange={(e) => setFormUser(e.target.value)}>
                    <option value="">Choose a user</option>
                    {users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role.replace(/_/g, ' ').toLowerCase()})</option>)}
                  </select>
                </label>
                <Button className={BTN} disabled={busy || !formUser} onClick={() => run(() => patch(dialog.device.id, { action: 'assign', userId: formUser }))}>
                  Give phone
                </Button>
              </>
            ) : null}

            {dialog.kind === 'release' ? (
              <>
                <p className="text-sm">This phone will have no user and stop working until it is set up again. Continue?</p>
                <Button className={BTN} disabled={busy} onClick={() => run(() => patch(dialog.device.id, { action: 'release' }))}>Yes, release phone</Button>
              </>
            ) : null}

            {dialog.kind === 'block' ? (
              <>
                <p className="text-sm">A blocked phone cannot send or log in. Tell us why.</p>
                <textarea className={`${FIELD} min-h-24 py-2`} value={formReason} onChange={(e) => setFormReason(e.target.value)} maxLength={500} placeholder="Reason" />
                <Button variant="destructive" className={BTN} disabled={busy || !formReason.trim()} onClick={() => run(() => patch(dialog.device.id, { action: 'block', reason: formReason.trim() }))}>
                  Yes, block phone
                </Button>
              </>
            ) : null}

            {dialog.kind === 'key' ? (
              <>
                <p className="text-sm">This makes a new key. The old key stops working. The new key is shown only once.</p>
                <Button className={BTN} disabled={busy} onClick={() => run(() => patch(dialog.device.id, { action: 'rotate-key' }), dialog.device.deviceUid)}>
                  Make new key
                </Button>
              </>
            ) : null}

            {dialog.kind === 'shown-key' ? <KeyQr deviceUid={dialog.deviceUid} syncKey={dialog.syncKey} /> : null}

            {dialog.kind === 'diary' ? (
              diary.length === 0 && !dialogError ? (
                <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
              ) : (
                <ol className="max-h-[60vh] space-y-2 overflow-y-auto">
                  {diary.map((e) => (
                    <li key={e.id} className="rounded-md border p-2 text-sm">
                      <div className="font-medium">{EVENT_WORDS[e.eventType] ?? e.eventType.replace(/_/g, ' ').toLowerCase()}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatTime(e.occurredAt)}{e.performedAsRole ? ` - ${e.performedAsRole.replace(/_/g, ' ').toLowerCase()}` : ''}
                      </div>
                    </li>
                  ))}
                </ol>
              )
            ) : null}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
