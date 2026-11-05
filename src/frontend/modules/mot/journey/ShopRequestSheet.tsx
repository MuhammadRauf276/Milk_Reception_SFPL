'use client';

import { typePakistaniCnic, typePakistaniMobile } from '@/lib/pakistani-identity';
import { useLocalFormDraft } from '@/frontend/hooks/useLocalFormDraft';
import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { getErrorMessage } from '@/lib/errors';
import { queueShopRequest, syncPendingShopRequests } from '../offlineStore';
import { MotSheet, sheetInputClass, sheetLabelClass, sheetPrimaryButtonClass } from '../MotSheet';
import { SheetError } from '../workspace/SheetError';

interface Props {
  routeId?: string;
  routeName?: string;
  deviceGps: { latitude: number; longitude: number } | null;
  gpsBadge: React.ReactNode;
  onClose: () => void;
}

function shapeIdentity(key: string, value: string): string {
  if (key === 'phone_number') return typePakistaniMobile(value);
  if (key === 'cnic') return typePakistaniCnic(value);
  return value;
}

const EMPTY_FORM = { shop_name: '', owner_name: '', phone_number: '', cnic: '', area_id: '', chiller_ownership_id: '' };

interface ShopRequestOptions {
  areas: Array<{ id: string; name: string; area_code: string }>;
  chillers: Array<{ id: string; name: string }>;
}

/** Areas and chiller types for the form. The last list stays on the phone for use without signal. */
function useShopRequestOptions(routeId?: string): ShopRequestOptions {
  const storageKey = `mot-shop-request-options:${routeId ?? ''}`;
  const [options, setOptions] = useState<ShopRequestOptions>({ areas: [], chillers: [] });
  useEffect(() => {
    if (!routeId) return;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) setOptions(JSON.parse(saved) as ShopRequestOptions);
    } catch {
      // Nothing saved: the list arrives from the server below.
    }
    let cancelled = false;
    fetch(`/api/zmcc/mot/shop-request-options?route_id=${encodeURIComponent(routeId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ShopRequestOptions | null) => {
        if (cancelled || !data) return;
        setOptions(data);
        try {
          localStorage.setItem(storageKey, JSON.stringify(data));
        } catch {
          // Storage full: the form still works while online.
        }
      })
      .catch(() => {
        // No signal: the saved list stays.
      });
    return () => {
      cancelled = true;
    };
  }, [routeId, storageKey]);
  return options;
}

/** Asks for a new shop met in the field. Queued on the phone, so it works offline. */
export function ShopRequestSheet({ routeId, routeName, deviceGps, gpsBadge, onClose }: Props) {
  const [form, setForm] = useState(EMPTY_FORM);
  const options = useShopRequestOptions(routeId);
  const [submitting, setSubmitting] = useState(false);
  const formDraft = useLocalFormDraft({
    formKey: `shop-request:${routeId}`,
    values: form,
    onRestore: (fields) => setForm((prev) => ({ ...prev, ...fields })),
  });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.shop_name.trim()) {
      setError('Shop name is required.');
      return;
    }
    if (!form.owner_name.trim()) {
      setError('Owner name is required.');
      return;
    }
    if (!form.phone_number.trim()) {
      setError('Phone number is required.');
      return;
    }
    if (!form.cnic.trim()) {
      setError('CNIC is required.');
      return;
    }
    if (options.areas.length > 0 && !areaId) {
      setError('Please choose the area.');
      return;
    }
    if (options.chillers.length > 0 && !form.chiller_ownership_id) {
      setError('Please choose the chiller ownership.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await queueShopRequest({
        shop_name: form.shop_name.trim(),
        owner_name: form.owner_name.trim(),
        phone_number: form.phone_number.trim(),
        cnic: form.cnic.trim(),
        route_id: routeId,
        area_id: areaId || undefined,
        chiller_ownership_id: form.chiller_ownership_id || undefined,
        latitude: deviceGps?.latitude ?? null,
        longitude: deviceGps?.longitude ?? null,
      });

      if (typeof navigator !== 'undefined' && navigator.onLine) {
        syncPendingShopRequests().catch(() => {});
      }

      formDraft.clear();
      setSuccess('Shop request queued successfully. It will be added to your journey once approved.');
      setForm(EMPTY_FORM);
      closeTimer.current = setTimeout(onClose, 1500);
    } catch (err) {
      setError(getErrorMessage(err) || 'Failed to submit shop request.');
    } finally {
      setSubmitting(false);
    }
  };

  // One area needs no choosing.
  const areaId = form.area_id || (options.areas.length === 1 ? options.areas[0].id : '');

  const field = (key: 'shop_name' | 'owner_name' | 'phone_number' | 'cnic', label: string, placeholder: string) => (
    <div className="min-w-0">
      <label htmlFor={`shop-request-${key}`} className={sheetLabelClass}>
        {label} <span className="text-rose-500">*</span>
      </label>
      <input
        id={`shop-request-${key}`}
        type="text"
        required
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: shapeIdentity(key, e.target.value) })}
        placeholder={placeholder}
        className={sheetInputClass}
      />
    </div>
  );

  return (
    <MotSheet title="Request New Shop in Field" subtitle={`Route: ${routeName || 'Current Route'}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <SheetError message={error} />
        {success && (
          <div className="bg-card border-border flex items-center space-x-2 rounded-xl border p-3 text-xs text-emerald-800">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{success}</span>
          </div>
        )}
        {field('shop_name', 'Shop Name', 'e.g. Al-Madina Dairy')}
        {field('owner_name', 'Owner Name', 'e.g. Shop Owner')}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {field('phone_number', 'Mobile Phone', '0300-1234567')}
          {field('cnic', 'CNIC', '35201-1234567-1')}
        </div>
        {options.areas.length > 0 && (
          <div className="min-w-0">
            <label htmlFor="shop-request-area" className={sheetLabelClass}>
              Area <span className="text-rose-500">*</span>
            </label>
            <select
              id="shop-request-area"
              required
              value={areaId}
              onChange={(e) => setForm({ ...form, area_id: e.target.value })}
              className={sheetInputClass}
            >
              <option value="">Choose area</option>
              {options.areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.area_code}
                </option>
              ))}
            </select>
          </div>
        )}
        {options.chillers.length > 0 && (
          <div className="min-w-0">
            <label htmlFor="shop-request-chiller" className={sheetLabelClass}>
              Chiller Ownership <span className="text-rose-500">*</span>
            </label>
            <select
              id="shop-request-chiller"
              required
              value={form.chiller_ownership_id}
              onChange={(e) => setForm({ ...form, chiller_ownership_id: e.target.value })}
              className={sheetInputClass}
            >
              <option value="">Choose chiller ownership</option>
              {options.chillers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="bg-card border-border flex items-center justify-between rounded-xl border p-2.5 text-[11px] text-slate-600">
          <span className="flex items-center gap-2 font-medium">Device GPS: {gpsBadge}</span>
          <span className="font-semibold text-foreground">
            {deviceGps ? `${deviceGps.latitude.toFixed(6)}, ${deviceGps.longitude.toFixed(6)}` : 'Waiting for GPS…'}
          </span>
        </div>
        <button type="submit" disabled={submitting} className={sheetPrimaryButtonClass}>
          {submitting ? 'Submitting…' : 'Submit Request'}
        </button>
      </form>
    </MotSheet>
  );
}
