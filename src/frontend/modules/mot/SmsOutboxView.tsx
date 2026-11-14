'use client';

import { formatDateTime } from '@/lib/format';
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { User } from '@core/types';
import { AlertTriangle, CheckCircle2, Clock, Send, MessageSquare, Copy, Check, QrCode } from 'lucide-react';
import { getErrorMessage } from '@/lib/errors';
import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import { formatLabel } from '@/lib/format';

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

  const outboxQuery = useQuery({
    queryKey: ['mot', 'sms-outbox', statusFilter],
    queryFn: ({ signal }) =>
      fetchJson<{ items?: SmsOutboxItem[] }>(
        statusFilter === 'ALL' ? '/api/zmcc/mot/sms-outbox' : `/api/zmcc/mot/sms-outbox?status=${statusFilter}`,
        { signal }
      ),
    placeholderData: (prev) => prev,
    // Pending receipts get sent in the background: poll gently, only while visible and online.
    refetchInterval: () =>
      typeof document !== 'undefined' && (document.hidden || !navigator.onLine) ? false : 60_000,
  });
  const items: SmsOutboxItem[] = outboxQuery.data?.items ?? [];
  const loading = outboxQuery.isFetching;
  const queryError = outboxQuery.error;
  useEffect(() => {
    if (queryError) setError(getErrorMessage(queryError) || 'Error loading SMS outbox.');
  }, [queryError]);

  const fetchOutbox = () => {
    setError(null);
    return outboxQuery.refetch();
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

  const columns: DataColumn<SmsOutboxItem>[] = [
    {
      key: 'recipient',
      header: 'Shop & Recipient',
      label: 'Shop & Recipient',
      primary: true,
      cell: (item) => (
        <div>
          <div className="font-semibold text-foreground">{item.recipient_phone}</div>
          <div className="text-xs text-muted-foreground">
            {item.collection?.shop_name || '—'}
          </div>
        </div>
      ),
    },
    {
      key: 'message',
      header: 'WhatsApp Receipt Message',
      label: 'WhatsApp Receipt Message',
      className: 'max-w-xs',
      cell: (item) => (
        <div className="bg-card border-border p-3 rounded-lg border text-xs tabular-nums text-foreground whitespace-pre-line wrap-break-word font-mono">
          {item.message_body}
        </div>
      ),
    },
    {
      key: 'milk',
      header: 'Milk Details',
      label: 'Milk Details',
      cell: (item) => (
        <div>
          <div className="font-semibold text-foreground">{item.collection?.gross_liters} L</div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      label: 'Status',
      cell: (item) => (
        <span
          className={`px-3 py-0.5 rounded-md text-xs font-semibold inline-flex items-center space-x-1 ${
            item.status === 'SENT'
              ? 'bg-emerald-100 text-emerald-800'
              : item.status === 'FAILED'
              ? 'bg-rose-100 text-rose-800'
              : 'bg-amber-100 text-amber-800'
          }`}
        >
          {item.status === 'SENT' && <CheckCircle2 className="w-2.5 h-2.5 mr-1" />}
          {item.status === 'PENDING' && <Clock className="w-2.5 h-2.5 mr-1" />}
          {formatLabel(item.status)}
        </span>
      ),
    },
    {
      key: 'logged',
      header: 'Logged At',
      label: 'Logged At',
      cell: (item) => <span className="text-muted-foreground text-xs">{formatDateTime(item.created_at)}</span>,
    },
    {
      key: 'actions',
      header: 'Actions',
      label: 'Actions',
      actions: true,
      align: 'right',
      cell: (item) => (
        <div className="inline-flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => handleCopy(item.id, item.message_body)}
            className="min-h-11 min-w-11 inline-flex items-center space-x-1 px-3 py-2 rounded-lg text-xs font-semibold border border-action/30 text-action hover:bg-action-soft transition"
            title="Copy receipt to clipboard"
          >
            {copiedId === item.id ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                <span className="text-emerald-700">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                <span>Copy</span>
              </>
            )}
          </button>
          <a
            href={`https://wa.me/${item.recipient_phone.replace(/\D/g, '').replace(/^0/, '92')}?text=${encodeURIComponent(item.message_body)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center space-x-1 px-3 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs transition"
            title={`Send WhatsApp message to ${item.recipient_phone}`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>WhatsApp</span>
          </a>
        </div>
      ),
    },
  ];
  return (
    <div className="space-y-4 animate-panel-in">
      <div className="p-4 bg-card rounded-2xl border border-border shadow-2xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center space-x-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">WhatsApp receipts</h2>
          </div>
        </div>

        <div className="flex items-center space-x-2 flex-wrap gap-y-2">
          <div className="bg-card border-border inline-flex rounded-xl border p-0.5" role="group" aria-label="Status filter">
            {[
              ['ALL', 'All'],
              ['PENDING', 'Pending'],
              ['SENT', 'Sent'],
              ['FAILED', 'Failed'],
            ].map(([v, l]) => (
              <button
                key={v}
                type="button"
                aria-pressed={statusFilter === v}
                onClick={() => setStatusFilter(v)}
                className={`min-h-[44px] px-3 rounded-lg text-xs font-semibold ${
                  statusFilter === v ? 'bg-primary text-white' : 'text-secondary-foreground'
                }`}
              >
                {l}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={fetchOutbox}
            className="min-h-11 min-w-11 flex items-center space-x-1 px-3 py-2 rounded-lg border border-action/30 text-xs font-semibold text-action hover:bg-action-soft"
          >
            <span>Refresh</span>
          </button>
          <Link
            href="/whatsapp-gateway"
            className="flex items-center space-x-1 px-3 py-2 rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-800 text-xs font-semibold hover:bg-emerald-100 shadow-2xs transition"
            title="Scan QR Code to link WhatsApp for automated sending"
          >
            <QrCode className="w-3.5 h-3.5 text-emerald-600" />
            <span>Link WhatsApp (QR Code)</span>
          </Link>
          <button
            type="button"
            disabled={isDispatching}
            onClick={handleDispatchAll}
            className="min-h-11 min-w-11 flex items-center space-x-1 px-3 py-2 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary-hover shadow-2xs transition disabled:opacity-50"
          >
            <Send className={`w-3.5 h-3.5 ${isDispatching ? 'opacity-50' : ''}`} />
            <span>{isDispatching ? 'Dispatching…' : 'Dispatch Queue'}</span>
          </button>
        </div>
      </div>

      {dispatchFeedback && (
        <div className="bg-card border-border p-3 border rounded-xl text-emerald-800 text-xs font-semibold flex items-center space-x-2 animate-panel-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{dispatchFeedback}</span>
        </div>
      )}

      {error && (
        <div className="bg-card border-border p-4 border rounded-2xl text-rose-800 text-xs font-semibold flex items-center space-x-2 animate-panel-in">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <DataTable
        columns={columns}
        rows={items}
        getRowId={(item) => item.id}
        loading={loading && items.length === 0}
        emptyTitle="No WhatsApp receipt records found."
      />
    </div>
  );
};
