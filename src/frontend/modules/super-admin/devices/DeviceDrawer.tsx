'use client';

import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { fetchJson } from '@/lib/query/fetchJson';
import { getErrorMessage } from '@/lib/errors';
import { FormDrawer } from '../shared/FormDrawer';

export type DeviceStatus = 'PENDING' | 'ACTIVE' | 'BLOCKED' | 'RELEASED';

export interface DeviceItem {
  id: string;
  deviceUid: string;
  label: string | null;
  status: DeviceStatus;
  isSharedStation: boolean;
  assignedUserName: string | null;
  procurementSourceName: string | null;
  blockReason: string | null;
  lastSeenAt: string | null;
  lastAppVersion: string | null;
  lastUnsentCount: number;
}

interface UserOption {
  id: string;
  name: string;
  role: string;
}
interface SourceOption {
  id: string;
  name: string;
  sourceType: string;
}
interface StationUserItem {
  userId: string;
  name: string;
  role: string;
  locked: boolean;
}
interface DiaryItem {
  id: string;
  eventType: string;
  performedAsRole: string | null;
  occurredAt: string;
  payload: unknown;
}

export type DeviceDialog =
  | { kind: 'register' }
  | { kind: 'assign'; device: DeviceItem }
  | { kind: 'release'; device: DeviceItem }
  | { kind: 'block'; device: DeviceItem }
  | { kind: 'key'; device: DeviceItem }
  | { kind: 'diary'; device: DeviceItem }
  | { kind: 'station'; device: DeviceItem }
  | { kind: 'shown-key'; deviceUid: string; syncKey: string };

const DIALOG_TITLES: Record<DeviceDialog['kind'], string> = {
  register: 'Register phone',
  assign: 'Give phone to a user',
  release: 'Release phone',
  block: 'Block phone',
  key: 'Make a new key',
  diary: 'Phone diary',
  station: 'Station users',
  'shown-key': 'Phone key',
};

const EVENT_WORDS: Record<string, string> = {
  REGISTERED: 'Phone registered',
  ASSIGNED: 'Given to a user',
  RELEASED: 'Phone released',
  BLOCKED: 'Phone blocked',
  STATION_PIN_SET: 'Station PIN set',
  STATION_PIN_RESET: 'Station PIN changed',
  STATION_PIN_REMOVED: 'Station user removed',
  STATION_PIN_LOCKED: 'Station PIN locked',
  KEY_ROTATED: 'New key made',
  LOGIN: 'User logged in',
};

const BTN = 'min-h-11 px-4';
const FIELD = 'min-h-11 w-full rounded-xl border border-border-strong bg-white px-3 text-sm';

export function formatTime(iso: string | null): string {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Karachi', dateStyle: 'medium', timeStyle: 'short' });
}

function KeyQr({ deviceUid, syncKey }: { deviceUid: string; syncKey: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(JSON.stringify({ deviceUid, key: syncKey }), { width: 240, margin: 2 })
      .then((url) => {
        if (alive) setSrc(url);
      })
      .catch(() => {
        if (alive) setSrc(null);
      });
    return () => {
      alive = false;
    };
  }, [deviceUid, syncKey]);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Scan this code with the phone. It is shown only now. Close it only after the phone is set up.</p>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="QR code for phone setup" width={240} height={240} className="mx-auto rounded-md border bg-white" />
      ) : null}
      <div className="break-all rounded-md border bg-muted p-3 text-xs">
        <div>
          <strong>Phone ID:</strong> {deviceUid}
        </div>
        <div>
          <strong>Key:</strong> {syncKey}
        </div>
      </div>
    </div>
  );
}

const roleWords = (r: string) => r.replace(/_/g, ' ').toLowerCase();

interface Props {
  dialog: DeviceDialog;
  onClose: () => void;
  onShowKey: (deviceUid: string, syncKey: string) => void;
}

/** Bottom-sheet for every phone action (register, assign, release, block, key, station users, diary). */
export function DeviceDrawer({ dialog, onClose, onShowKey }: Props) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [formUid, setFormUid] = useState(() =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : ''
  );
  const [formLabel, setFormLabel] = useState('');
  const [formShared, setFormShared] = useState(false);
  const [formSource, setFormSource] = useState('');
  const [formUser, setFormUser] = useState('');
  const [formReason, setFormReason] = useState('');
  const [formPin, setFormPin] = useState('');

  const needsOptions = dialog.kind === 'register' || dialog.kind === 'assign' || dialog.kind === 'station';
  const optionsQuery = useQuery({
    queryKey: ['super-admin', 'devices', 'options'],
    queryFn: ({ signal }) =>
      fetchJson<{ users: UserOption[]; sources: SourceOption[] }>('/api/devices?page=1&pageSize=1', { signal }),
    enabled: needsOptions,
  });
  const userOptions = useMemo(
    () =>
      (optionsQuery.data?.users ?? []).map((u) => ({ value: u.id, label: `${u.name} (${roleWords(u.role)})`, keywords: u.role })),
    [optionsQuery.data]
  );
  const sourceOptions = useMemo(
    () => [{ value: '', label: 'No ZMCC' }, ...(optionsQuery.data?.sources ?? []).map((s) => ({ value: s.id, label: s.name }))],
    [optionsQuery.data]
  );

  const deviceId = 'device' in dialog ? dialog.device.id : null;
  const stationKey = ['super-admin', 'devices', deviceId, 'station-users'];
  const stationQuery = useQuery({
    queryKey: stationKey,
    queryFn: ({ signal }) => fetchJson<{ users: StationUserItem[] }>(`/api/devices/${deviceId}/station-users`, { signal }),
    enabled: dialog.kind === 'station',
  });
  const diaryQuery = useQuery({
    queryKey: ['super-admin', 'devices', deviceId, 'diary'],
    queryFn: ({ signal }) => fetchJson<{ entries: DiaryItem[] }>(`/api/devices/${deviceId}/diary?limit=100`, { signal }),
    enabled: dialog.kind === 'diary',
  });

  const run = useMutation({
    mutationFn: ({ request }: { request: () => Promise<{ syncKey?: string }>; deviceUid?: string }) => request(),
    onSuccess: (result, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['super-admin', 'devices', 'list'] });
      if (result.syncKey && vars.deviceUid) onShowKey(vars.deviceUid, result.syncKey);
      else onClose();
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const stationChange = useMutation({
    mutationFn: ({ method, body }: { method: 'PUT' | 'DELETE'; body: Record<string, string> }) =>
      fetchJson<{ users: StationUserItem[] }>(`/api/devices/${deviceId}/station-users`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: (d) => {
      queryClient.setQueryData(stationKey, d);
      setFormUser('');
      setFormPin('');
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const busy = run.isPending || stationChange.isPending;
  const exec = (request: () => Promise<{ syncKey?: string }>, deviceUid?: string) => {
    setError(null);
    run.mutate({ request, deviceUid });
  };
  const patch = (id: string, body: Record<string, unknown>) =>
    fetchJson<{ syncKey?: string }>(`/api/devices/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  const queryError =
    (stationQuery.error && getErrorMessage(stationQuery.error)) || (diaryQuery.error && getErrorMessage(diaryQuery.error)) || null;
  const stationUsers = stationQuery.data?.users ?? [];
  const diary = diaryQuery.data?.entries ?? [];

  const userPicker = (
    <label className="block space-y-1 text-sm font-medium">
      User
      <Combobox
        options={userOptions}
        value={formUser}
        onValueChange={setFormUser}
        placeholder="Choose a user"
        searchPlaceholder="Search users"
      />
    </label>
  );

  return (
    <FormDrawer open onClose={onClose} busy={busy} error={error || queryError} title={DIALOG_TITLES[dialog.kind]}>
      <div className="space-y-4 text-sm">
        {dialog.kind === 'register' ? (
          <>
            <label className="block space-y-1 font-medium">
              Phone ID
              <input className={FIELD} value={formUid} onChange={(e) => setFormUid(e.target.value)} maxLength={64} />
            </label>
            <label className="block space-y-1 font-medium">
              Name of phone
              <input
                className={FIELD}
                value={formLabel}
                onChange={(e) => setFormLabel(e.target.value)}
                maxLength={150}
                placeholder="For example: Gujrat MOT phone 1"
              />
            </label>
            <label className="block space-y-1 font-medium">
              ZMCC (if any)
              <Combobox options={sourceOptions} value={formSource} onValueChange={setFormSource} placeholder="No ZMCC" searchPlaceholder="Search ZMCC" />
            </label>
            <label className="flex min-h-11 items-center gap-2 font-medium">
              <input type="checkbox" className="size-5" checked={formShared} onChange={(e) => setFormShared(e.target.checked)} />
              Shared station computer
            </label>
            <Button
              className={BTN}
              disabled={busy || !formUid.trim() || !formLabel.trim()}
              onClick={() =>
                exec(
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
            {userPicker}
            <Button
              className={BTN}
              disabled={busy || !formUser}
              onClick={() => exec(() => patch(dialog.device.id, { action: 'assign', userId: formUser }), dialog.device.deviceUid)}
            >
              Give phone
            </Button>
          </>
        ) : null}

        {dialog.kind === 'release' ? (
          <>
            <p>This phone will have no user and stop working until it is set up again. Continue?</p>
            <Button className={BTN} disabled={busy} onClick={() => exec(() => patch(dialog.device.id, { action: 'release' }))}>
              Yes, release phone
            </Button>
          </>
        ) : null}

        {dialog.kind === 'block' ? (
          <>
            <p>A blocked phone cannot send or log in. Tell us why.</p>
            <textarea
              className={`${FIELD} min-h-24 py-2`}
              value={formReason}
              onChange={(e) => setFormReason(e.target.value)}
              maxLength={500}
              placeholder="Reason"
            />
            <Button
              variant="destructive"
              className={BTN}
              disabled={busy || !formReason.trim()}
              onClick={() => exec(() => patch(dialog.device.id, { action: 'block', reason: formReason.trim() }))}
            >
              Yes, block phone
            </Button>
          </>
        ) : null}

        {dialog.kind === 'key' ? (
          <>
            <p>This makes a new key. The old key stops working. The new key is shown only once.</p>
            <Button
              className={BTN}
              disabled={busy}
              onClick={() => exec(() => patch(dialog.device.id, { action: 'rotate-key' }), dialog.device.deviceUid)}
            >
              Make new key
            </Button>
          </>
        ) : null}

        {dialog.kind === 'shown-key' ? <KeyQr deviceUid={dialog.deviceUid} syncKey={dialog.syncKey} /> : null}

        {dialog.kind === 'station' ? (
          <>
            <p className="text-muted-foreground">
              These people can log in on this computer with a name card and a 4-digit PIN. After 5 wrong tries the PIN locks. Set a new PIN to unlock it.
            </p>
            {stationUsers.length === 0 && !queryError ? (
              <p className="text-muted-foreground">{stationQuery.isPending ? 'Loading…' : 'No users yet.'}</p>
            ) : (
              <ul className="space-y-2">
                {stationUsers.map((u) => (
                  <li key={u.userId} className="flex items-center justify-between gap-2 rounded-md border p-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{u.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {roleWords(u.role)}
                        {u.locked ? ' - PIN locked' : ''}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      className={BTN}
                      disabled={busy}
                      aria-label={`Remove ${u.name}`}
                      onClick={() => {
                        setError(null);
                        stationChange.mutate({ method: 'DELETE', body: { userId: u.userId } });
                      }}
                    >
                      <Trash2 aria-hidden /> Remove
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <div className="space-y-3 border-t pt-3">
              {userPicker}
              <label className="block space-y-1 font-medium">
                4-digit PIN
                <input
                  className={FIELD}
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={4}
                  value={formPin}
                  onChange={(e) => setFormPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                />
              </label>
              <Button
                className={BTN}
                disabled={busy || !formUser || formPin.length !== 4}
                onClick={() => {
                  setError(null);
                  stationChange.mutate({ method: 'PUT', body: { userId: formUser, pin: formPin } });
                }}
              >
                Save PIN
              </Button>
            </div>
          </>
        ) : null}

        {dialog.kind === 'diary' ? (
          diary.length === 0 && !queryError ? (
            <p className="text-muted-foreground">{diaryQuery.isPending ? 'Loading…' : 'Nothing recorded yet.'}</p>
          ) : (
            <ol className="max-h-[60vh] space-y-2 overflow-y-auto">
              {diary.map((e) => (
                <li key={e.id} className="rounded-md border p-2">
                  <div className="font-medium">{EVENT_WORDS[e.eventType] ?? roleWords(e.eventType)}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatTime(e.occurredAt)}
                    {e.performedAsRole ? ` - ${roleWords(e.performedAsRole)}` : ''}
                  </div>
                </li>
              ))}
            </ol>
          )
        ) : null}
      </div>
    </FormDrawer>
  );
}
