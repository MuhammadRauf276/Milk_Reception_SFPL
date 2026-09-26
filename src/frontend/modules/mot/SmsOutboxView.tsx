'use client';

import React, { useState, useEffect } from 'react';
import { User } from '@core/types';
import { Phone, Mail, RotateCw, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';

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

export const SmsOutboxView: React.FC<SmsOutboxViewProps> = ({ currentUser }) => {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<SmsOutboxItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  const fetchOutbox = async () => {
    setLoading(true);
    setError(null);
    try {
      const url = statusFilter === 'ALL'
        ? '/api/zmcc/mot/sms-outbox'
        : `/api/zmcc/mot/sms-outbox?status=${statusFilter}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Failed to fetch SMS outbox.');
      }
      setItems(json.items || []);
    } catch (err: any) {
      setError(err.message || 'Error loading SMS outbox.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOutbox();
  }, [statusFilter]);

  return (
    <div className="space-y-4">
      {/* Header & Controls */}
      <div className="p-4 bg-white rounded-2xl border border-[#EAE4D5] shadow-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-blue-50 text-[#1E3A8A] rounded-xl">
            <Phone className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-black text-[#111311]">Collection SMS Outbox</h2>
            <p className="text-xs text-slate-500">
              Real-time audit log of shopkeeper collection notification SMS messages
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 rounded-xl border border-[#EAE4D5] text-xs font-bold text-slate-700 bg-white"
          >
            <option value="ALL">All Statuses</option>
            <option value="PENDING">Pending Delivery</option>
            <option value="SENT">Sent</option>
            <option value="FAILED">Failed</option>
          </select>
          <button
            type="button"
            onClick={fetchOutbox}
            className="flex items-center space-x-1 px-3 py-1.5 rounded-xl border border-[#EAE4D5] text-xs font-bold text-slate-700 hover:bg-[#F4F0E6]"
          >
            <RotateCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-bold flex items-center space-x-2">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Outbox Table */}
      <div className="bg-white rounded-2xl border border-[#EAE4D5] shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#EAE4D5] bg-[#FDFBF9] text-[10px] font-black uppercase text-slate-500 tracking-wider">
                <th className="p-3">Recipient & Shop</th>
                <th className="p-3">SMS Message Content</th>
                <th className="p-3">Collection Details</th>
                <th className="p-3">Status</th>
                <th className="p-3">Created At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EAE4D5] text-xs">
              {loading && items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-500 font-bold">
                    Loading SMS queue...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-500">
                    No SMS outbox records found.
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="hover:bg-[#FDFBF9]">
                    <td className="p-3">
                      <div className="font-bold text-[#111311]">{item.recipient_phone}</div>
                      <div className="text-[11px] text-slate-500">
                        {item.collection?.shop_name} ({item.collection?.shop_code})
                      </div>
                    </td>
                    <td className="p-3 max-w-xs">
                      <div className="p-2 rounded-lg bg-slate-50 border border-slate-200 text-[11px] font-mono text-slate-700 whitespace-pre-line break-words">
                        {item.message_body}
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="font-mono font-bold text-blue-900">
                        {item.collection?.collection_number}
                      </div>
                      <div className="text-[11px] text-slate-600">
                        {item.collection?.gross_liters} Liters
                      </div>
                    </td>
                    <td className="p-3">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase inline-flex items-center space-x-1 ${
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
