'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { User } from '@core/types';
import { Phone, AlertTriangle, CheckCircle2, Clock, Send, MessageSquare, Copy, Check, QrCode } from 'lucide-react';
import { getErrorMessage } from '@/lib/errors';
import { fetchJson } from '@/lib/fetch-json';

interface SmsOutboxViewProps {
  currentUser: User | null;
}

interface SmsOutboxItem {
  id: string;
  collection_id: string;
  recipient_phone: string;
  message_body: string;
  status: 'PENDING' | 'SENT' | 'FAILED';
  attempt_count: number;
  created_at: string;
  sent_at: string | null;
  collection: {
    id: string;
    collection_number: string;
    journey_id: string;
    gross_liters: number;
    shop_code: string;
    shop_name: string;
  } | null;
}

export const SmsOutboxView: React.FC<SmsOutboxViewProps> = () => {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<SmsOutboxItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [isDispatching, setIsDispatching] = useState(false);
  const [dispatchFeedback, setDispatchFeedback] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = (id: string, text: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
      }).catch(() => {});
    }
  };

  const loadOutbox = useCallback(() => {
    const url = statusFilter === 'ALL'
      ? '/api/zmcc/mot/sms-outbox'
      : `/api/zmcc/mot/sms-outbox?status=${statusFilter}`;
    return fetchJson<{ items?: SmsOutboxItem[] }>(url, undefined, 'Failed to fetch SMS outbox.')
      .then(
        (json) => {
          setItems(json.items || []);
          setError(null);
        },
        (err) => setError(getErrorMessage(err) || 'Error loading SMS outbox.')
      )
      .finally(() => setLoading(false));
  }, [statusFilter]);

  const fetchOutbox = () => {
    setLoading(true);
    setError(null);
    return loadOutbox();
  };

  const handleDispatchAll = async () => {
    setIsDispatching(true);
    setDispatchFeedback(null);
    setError(null);
    try {
      const res = await fetch('/api/cron/process-sms', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setDispatchFeedback(
          data.processed > 0
            ? `Dispatched ${data.processed} pending SMS record(s).`
            : 'No pending SMS records needed dispatching.'
        );
        fetchOutbox();
      } else {
        setError(data.error || 'Failed to dispatch SMS queue.');
      }
    } catch (err) {
      setError(getErrorMessage(err) || 'Error triggering SMS dispatch.');
    } finally {
      setIsDispatching(false);
    }
  };

  useEffect(() => {
    loadOutbox();
  }, [loadOutbox]);

  return (
    <div className="space-y-4 animate-panel-in">
      <div className="p-4 bg-white rounded-xl border border-border shadow-2xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-emerald-50 text-emerald-700 rounded-xl">
            <MessageSquare className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">WhatsApp Collection Receipts</h2>
          </div>
        </div>

        <div className="flex items-center space-x-2 flex-wrap gap-y-2">
          <select
            value={statusFilter}
            onChange={(e) => {
              setLoading(true);
              setStatusFilter(e.target.value);
            }}
            className="px-3 py-1.5 rounded-xl border border-border text-xs font-semibold text-slate-700 bg-white"
          >
            <option value="ALL">All statuses</option>
            <option value="PENDING">Pending</option>
            <option value="SENT">Sent</option>
            <option value="FAILED">Failed</option>
          </select>
          <button
            type="button"
            onClick={fetchOutbox}
            className="flex items-center space-x-1 px-3 py-1.5 rounded-xl border border-border text-xs font-semibold text-slate-700 hover:bg-muted"
          >
            <span>Refresh</span>
          </button>
          <Link
            href="/whatsapp-gateway"
            className="flex items-center space-x-1 px-3 py-1.5 rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-800 text-xs font-semibold hover:bg-emerald-100 shadow-2xs transition"
            title="Scan QR Code to link WhatsApp for automated sending"
          >
            <QrCode className="w-3.5 h-3.5 text-emerald-600" />
            <span>Link WhatsApp (QR Code)</span>
          </Link>
          <button
            type="button"
            disabled={isDispatching}
            onClick={handleDispatchAll}
            className="flex items-center space-x-1 px-3 py-1.5 rounded-xl bg-primary text-white text-xs font-semibold hover:bg-primary-hover shadow-2xs transition disabled:opacity-50"
          >
            <Send className={`w-3.5 h-3.5 ${isDispatching ? 'animate-pulse' : ''}`} />
            <span>{isDispatching ? 'Dispatching…' : 'Dispatch Queue'}</span>
          </button>
        </div>
      </div>

      {dispatchFeedback && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs font-semibold flex items-center space-x-2 animate-panel-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{dispatchFeedback}</span>
        </div>
      )}

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-semibold flex items-center space-x-2 animate-panel-in">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="bg-white rounded-xl border border-border shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-border bg-subtle text-[10px] font-semibold uppercase text-slate-500 tracking-wider">
                <th className="p-3">Shop & Recipient</th>
                <th className="p-3">WhatsApp Receipt Message</th>
                <th className="p-3">Milk Details</th>
                <th className="p-3">Status</th>
                <th className="p-3">Logged At</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-xs">
              {loading && items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-500 font-semibold">
                    Loading receipts queue…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-500">
                    No WhatsApp receipt records found.
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="hover:bg-subtle">
                    <td className="p-3">
                      <div className="font-semibold text-foreground">{item.recipient_phone}</div>
                      <div className="text-[11px] text-slate-500">
                        {item.collection?.shop_name} ({item.collection?.shop_code})
                      </div>
                    </td>
                    <td className="p-3 max-w-xs">
                      <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-[11px] tabular-nums text-slate-800 whitespace-pre-line wrap-break-word font-mono">
                        {item.message_body}
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="tabular-nums font-semibold text-blue-900">
                        {item.collection?.collection_number}
                      </div>
                      <div className="text-[11px] text-slate-600">
                        {item.collection?.gross_liters} Liters
                      </div>
                    </td>
                    <td className="p-3">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase inline-flex items-center space-x-1 ${
                          item.status === 'SENT'
                            ? 'bg-emerald-100 text-emerald-800'
                            : item.status === 'FAILED'
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {item.status === 'SENT' && <CheckCircle2 className="w-2.5 h-2.5 mr-1" />}
                        {item.status === 'PENDING' && <Clock className="w-2.5 h-2.5 mr-1" />}
                        {item.status}
                      </span>
                    </td>
                    <td className="p-3 text-slate-500 text-[11px]">
                      {new Date(item.created_at).toLocaleString()}
                    </td>
                    <td className="p-3 text-right">
                      <div className="inline-flex items-center justify-end space-x-1.5">
                        <button
                          type="button"
                          onClick={() => handleCopy(item.id, item.message_body)}
                          className="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-border text-slate-700 hover:bg-slate-100 transition"
                          title="Copy receipt to clipboard"
                        >
                          {copiedId === item.id ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                              <span className="text-emerald-700">Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5 text-slate-500" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                        <a
                          href={`https://wa.me/${item.recipient_phone.replace(/\D/g, '').replace(/^0/, '92')}?text=${encodeURIComponent(item.message_body)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs transition"
                          title={`Send WhatsApp message to ${item.recipient_phone}`}
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                          <span>WhatsApp</span>
                        </a>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
