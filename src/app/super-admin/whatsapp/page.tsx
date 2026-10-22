'use client';

import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Image from 'next/image';
import {
  MessageSquare,
  ShieldCheck,
  Send,
  LogOut,
  AlertTriangle,
  CheckCircle2,
  Store,
  QrCode,
  Radio,
  FileText,
  Users,
  Loader2,
} from 'lucide-react';
import { getErrorMessage } from '@/lib/errors';
import { fetchJson } from '@/lib/query/fetchJson';
import { Combobox } from '@/components/ui/combobox';

interface GatewayStatus {
  status: 'OFFLINE' | 'DISCONNECTED' | 'CONNECTING' | 'SCAN_QR' | 'CONNECTED';
  user?: { id: string; name: string } | null;
  qr?: string | null;
  timestamp?: string;
  message?: string;
}

interface ShopItem {
  id: string;
  shop_code: string;
  shop_name: string;
  owner_name: string;
  phone_number: string;
}

interface OutboxItem {
  id: string;
  recipient_phone: string;
  message_body: string;
  status: 'PENDING' | 'SENT' | 'FAILED';
  created_at: string;
  collection: {
    shop_name: string;
    shop_code: string;
    collection_number: string;
    gross_liters: number;
  } | null;
}

export default function SuperAdminWhatsAppPage() {
  const queryClient = useQueryClient();

  // Shop selection and compose state
  const [targetMode, setTargetMode] = useState<'SINGLE' | 'ALL_USER'>('ALL_USER');
  const [pickedShopId, setPickedShopId] = useState<string>('');

  const [messageText, setMessageText] = useState<string>(
    '*Shakarganj Milk Reception Receipt*\n*Shop:* Bismillah Dairy Collection Center\n*RMR No:* 005102 | *Journey:* #JRN-HAS-20261007-001\n*Vehicle:* LES-19-4821 | *MOT:* Muhammad Tariq\n*Gross Qty:* 210.00 L\n*LR:* 29.0 | *Fat:* 4.1%\n*SNF:* 8.52% | *Total Solids:* 12.60%\n*@13% TS:* 203.86 L\n*Status:* Verified & Dispatched via Super Admin\n_Shakarganj Food Products Ltd, Field Reception_'
  );

  const [isSending, setIsSending] = useState<boolean>(false);
  const [dispatchResult, setDispatchResult] = useState<{
    success: boolean;
    count: number;
    message: string;
  } | null>(null);

  // 1. Gateway status (polled every 4s while the page is visible)
  const gatewayQuery = useQuery({
    queryKey: ['super-admin', 'whatsapp', 'status'],
    queryFn: async ({ signal }): Promise<GatewayStatus> => {
      try {
        return await fetchJson<GatewayStatus>('/api/whatsapp/status', { cache: 'no-store', signal });
      } catch (err) {
        if (signal.aborted) throw err;
        return { status: 'OFFLINE', message: getErrorMessage(err) || 'Failed to reach WhatsApp Gateway daemon.' };
      }
    },
    refetchInterval: 4000,
    refetchIntervalInBackground: false,
  });
  const gateway = gatewayQuery.data ?? null;
  const refreshing = gatewayQuery.isFetching && !gatewayQuery.isPending;
  const fetchGatewayStatus = async () => {
    await gatewayQuery.refetch();
  };

  // 2. Shops
  const shopsQuery = useQuery({
    queryKey: ['super-admin', 'whatsapp', 'shops'],
    queryFn: ({ signal }) => fetchJson<{ shops?: ShopItem[] }>('/api/zmcc/shops?is_active=true', { signal }),
  });
  const shops = useMemo(() => shopsQuery.data?.shops ?? [], [shopsQuery.data]);
  const loadingShops = shopsQuery.isPending;
  const selectedShopId = pickedShopId || shops[0]?.id || '';
  const setSelectedShopId = setPickedShopId;
  const shopOptions = useMemo(
    () => shops.map((shop) => ({ value: shop.id, label: `${shop.shop_name} · ${shop.shop_code}`, keywords: `${shop.owner_name} ${shop.phone_number}` })),
    [shops]
  );

  // 3. Outbox history log
  const outboxQuery = useQuery({
    queryKey: ['super-admin', 'whatsapp', 'outbox'],
    queryFn: ({ signal }) => fetchJson<{ items?: OutboxItem[] }>('/api/zmcc/mot/sms-outbox', { signal }),
  });
  const outbox = outboxQuery.data?.items ?? [];
  const loadingOutbox = outboxQuery.isPending;
  const loadOutbox = () => queryClient.invalidateQueries({ queryKey: ['super-admin', 'whatsapp', 'outbox'] });

  // Handle Logout / Disconnect
  const handleDisconnect = async () => {
    if (!confirm('Disconnect this WhatsApp session? You will need to scan the QR code again.')) {
      return;
    }
    try {
      await fetch('/api/whatsapp/status', { method: 'POST' });
      await fetchGatewayStatus();
    } catch (err) {
      alert('Error disconnecting: ' + getErrorMessage(err));
    }
  };

  // Set Template Pre-sets
  const handleApplyTemplate = (type: 'RECEIPT' | 'RATE' | 'CHILLING') => {
    const selectedShop = shops.find((s) => s.id === selectedShopId) || shops[0];
    const sName = selectedShop?.shop_name || 'Bismillah Dairy Collection Center';
    const oName = selectedShop?.owner_name || 'Dairy Partner';

    if (type === 'RECEIPT') {
      setMessageText(
        `*Shakarganj Milk Reception Receipt*\n*Shop:* ${sName}\n*RMR No:* 005102 | *Journey:* #JRN-HAS-20261007-001\n*Vehicle:* LES-19-4821 | *MOT:* Muhammad Tariq\n*Gross Qty:* 210.00 L\n*LR:* 29.0 | *Fat:* 4.1%\n*SNF:* 8.52% | *Total Solids:* 12.60%\n*@13% TS:* 203.86 L\n*Status:* Verified & Dispatched Automatically\n_Shakarganj Food Products Ltd, Field Reception_`
      );
    } else if (type === 'RATE') {
      setMessageText(
        `*Shakarganj Milk Rate Announcement*\nDear ${oName} (${sName}),\nToday's milk procurement base rate has been updated. Quality incentives apply automatically based on TS analysis.\n_Shakarganj Food Products Ltd, Field Operations_`
      );
    } else if (type === 'CHILLING') {
      setMessageText(
        `*Shakarganj Milk Quality Advisory*\nDear ${oName} (${sName}),\nPlease pre-chill all collected milk below 4°C before the MOT arrives. This qualifies your shop for cold-chain quality bonuses.\n_Shakarganj Quality Assurance Desk_`
      );
    }
  };

  // Send WhatsApp message
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageText.trim()) return;

    setIsSending(true);
    setDispatchResult(null);

    const targetPhone = '03176826604';
    let sentCount = 0;
    const errors: string[] = [];

    try {
      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: targetPhone,
          message: messageText.trim(),
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        sentCount++;
        setDispatchResult({
          success: true,
          count: sentCount,
          message: `Successfully dispatched WhatsApp message to ${targetPhone} (Message ID: ${data.messageId || 'sent'})!`,
        });
        loadOutbox();
      } else {
        errors.push(data.error || 'Failed to send WhatsApp message.');
        setDispatchResult({
          success: false,
          count: 0,
          message: errors.join(', '),
        });
      }
    } catch (err) {
      setDispatchResult({
        success: false,
        count: 0,
        message: getErrorMessage(err) || 'Error communicating with WhatsApp gateway.',
      });
    } finally {
      setIsSending(false);
    }
  };

  const isConnected = gateway?.status === 'CONNECTED';
  const isScanQr = gateway?.status === 'SCAN_QR';
  const userShops = shops.filter((s) => s.phone_number === '03176826604');

  return (
    <div className="space-y-6 w-full max-w-full overflow-x-hidden animate-panel-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-border pb-4">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-emerald-600 text-white rounded-xl shadow-2xs">
            <MessageSquare className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground">
              WhatsApp gateway
            </h1>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => fetchGatewayStatus()}
            disabled={refreshing}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border border-border bg-white text-xs font-semibold text-slate-700 hover:bg-subtle transition shadow-2xs"
          >
            <span>Refresh Status</span>
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-border shadow-2xs p-5 sm:p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center space-x-3.5">
          <div
            className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-2xs ${
              isConnected
                ? 'bg-emerald-100 text-emerald-700 border border-emerald-300'
                : isScanQr
                ? 'bg-amber-100 text-amber-800 border border-amber-300'
                : 'bg-rose-100 text-rose-800 border border-rose-300'
            }`}
          >
            {isConnected ? (
              <ShieldCheck className="w-6 h-6" />
            ) : isScanQr ? (
              <QrCode className="w-6 h-6 animate-pulse" />
            ) : (
              <AlertTriangle className="w-6 h-6" />
            )}
          </div>

          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-base font-bold text-foreground">
                {isConnected
                  ? 'Connected'
                  : isScanQr
                  ? 'Scan QR Code to Link WhatsApp'
                  : 'Gateway Service Offline'}
              </h2>
              <span
                className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                  isConnected
                    ? 'bg-emerald-100 text-emerald-800'
                    : isScanQr
                    ? 'bg-amber-100 text-amber-900'
                    : 'bg-rose-100 text-rose-800'
                }`}
              >
                {gateway?.status || 'UNKNOWN'}
              </span>
            </div>
            <p className="text-xs text-slate-600 mt-0.5">
              {isConnected
                ? `Active Session: ${gateway?.user?.name || 'Shakarganj Milk Reception'} (${gateway?.user?.id || 'Connected'})`
                : isScanQr
                ? 'Scan the QR code below from WhatsApp (Linked Devices) to begin automated sending.'
                : 'Run "npm run whatsapp:gateway" to start the background WhatsApp daemon.'}
            </p>
          </div>
        </div>

        {isConnected && (
          <button
            type="button"
            onClick={handleDisconnect}
            className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-800 text-xs font-semibold transition shadow-2xs self-start md:self-auto"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Disconnect Session</span>
          </button>
        )}
      </div>

      {isScanQr && gateway?.qr && (
        <div className="bg-white rounded-2xl border border-border shadow-2xs p-6 grid grid-cols-1 md:grid-cols-2 gap-6 items-center animate-panel-in">
          <div className="flex flex-col items-center justify-center p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
            <div className="p-3 bg-white rounded-xl shadow-md border border-slate-200">
              <Image
                src={gateway.qr}
                alt="WhatsApp QR Code"
                width={220}
                height={220}
                unoptimized
                className="w-56 h-56 rounded-lg"
              />
            </div>
            <div className="text-[11px] font-semibold text-emerald-700 flex items-center space-x-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>Listening for scan… updates automatically</span>
            </div>
          </div>

          <div className="space-y-3 text-xs text-slate-700">
            <h3 className="font-bold text-sm text-foreground">How to Connect Super Admin WhatsApp:</h3>
            <ol className="list-decimal list-inside space-y-2 text-slate-600 pl-1 font-medium">
              <li>Open WhatsApp on the phone with the Shakarganj logo profile.</li>
              <li>Tap Settings / ⋮ &gt; <strong>Linked Devices</strong>.</li>
              <li>Tap <strong>Link a Device</strong> and point your camera at the QR code.</li>
            </ol>
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-blue-900 text-[11px]">
              <strong>Corporate Branding:</strong> Once linked, all dairy shops receive messages directly from this account showing your Shakarganj profile name and logo.
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white rounded-2xl border border-border shadow-2xs p-5 sm:p-6 space-y-4">
          <div className="border-b border-border pb-3 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-foreground flex items-center space-x-2">
                <Send className="w-4 h-4 text-emerald-600" />
                <span>Send WhatsApp to Shops</span>
              </h3>
            </div>
            <span className="text-[11px] font-semibold px-2.5 py-1 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-lg">
              Recipient: 03176826604
            </span>
          </div>

          {dispatchResult && (
            <div
              className={`p-3.5 rounded-xl border text-xs font-semibold flex items-center space-x-2 animate-panel-in ${
                dispatchResult.success
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-rose-50 border-rose-200 text-rose-900'
              }`}
            >
              {dispatchResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              )}
              <span>{dispatchResult.message}</span>
            </div>
          )}

          <form onSubmit={handleSendMessage} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Target Dairy Shop / Recipients
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => setTargetMode('ALL_USER')}
                  className={`p-2.5 rounded-xl border text-left text-xs font-semibold transition flex items-center space-x-2 ${
                    targetMode === 'ALL_USER'
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-950 ring-1 ring-emerald-500'
                      : 'border-border bg-white text-slate-700 hover:bg-subtle'
                  }`}
                >
                  <Radio className="w-4 h-4 text-emerald-600 shrink-0" />
                  <div>
                    <div className="font-bold">Active Test Shops ({userShops.length || 14})</div>
                    <div className="text-[10px] text-slate-500 font-mono">03176826604 (Your Number)</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setTargetMode('SINGLE')}
                  className={`p-2.5 rounded-xl border text-left text-xs font-semibold transition flex items-center space-x-2 ${
                    targetMode === 'SINGLE'
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-950 ring-1 ring-emerald-500'
                      : 'border-border bg-white text-slate-700 hover:bg-subtle'
                  }`}
                >
                  <Store className="w-4 h-4 text-emerald-600 shrink-0" />
                  <div>
                    <div className="font-bold">Single Selected Shop</div>
                    <div className="text-[10px] text-slate-500 font-mono">Specific Dairy Unit</div>
                  </div>
                </button>
              </div>

              {targetMode === 'SINGLE' && (
                <Combobox
                  options={shopOptions}
                  value={selectedShopId}
                  onValueChange={setSelectedShopId}
                  placeholder="Select shop"
                  searchPlaceholder="Search shops"
                />
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-slate-700">
                  Quick Message Templates
                </label>
                <div className="flex items-center space-x-1.5">
                  <button
                    type="button"
                    onClick={() => handleApplyTemplate('RECEIPT')}
                    className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100 transition"
                  >
                    Collection Receipt
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyTemplate('RATE')}
                    className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-blue-50 text-blue-800 border border-blue-200 hover:bg-blue-100 transition"
                  >
                    Rate Advisory
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyTemplate('CHILLING')}
                    className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100 transition"
                  >
                    Chilling Alert
                  </button>
                </div>
              </div>

              <textarea
                rows={6}
                required
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                placeholder="Type WhatsApp message here…"
                className="w-full text-xs font-mono border border-border rounded-xl p-3 bg-white text-foreground focus:ring-2 focus:ring-emerald-500 outline-hidden leading-relaxed shadow-2xs"
              />
              <div className="flex justify-between text-[11px] text-slate-400 mt-1">
                <span>Supports WhatsApp formatting: *bold*, _italics_</span>
                <span>{messageText.length} characters</span>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSending || !isConnected}
              className="w-full flex items-center justify-center space-x-2 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-md transition disabled:opacity-50"
            >
              <Send className={`w-4 h-4 ${isSending ? 'animate-pulse' : ''}`} />
              <span>
                {isSending
                  ? 'Dispatching via WhatsApp…'
                  : !isConnected
                  ? 'Connect WhatsApp to Send'
                  : 'Send WhatsApp Message to 03176826604'}
              </span>
            </button>
          </form>
        </div>

        <div className="lg:col-span-5 bg-white rounded-2xl border border-border shadow-2xs p-5 sm:p-6 space-y-4 flex flex-col">
          <div className="border-b border-border pb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold text-foreground flex items-center space-x-2">
              <Users className="w-4 h-4 text-primary" />
              <span>Configured Development Shops</span>
            </h3>
            <span className="text-[10px] font-bold uppercase text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
              03176826604
            </span>
          </div>

          <p className="text-xs text-slate-500">
            All 14 active Hasilpur demonstration shops are set to your number:
          </p>

          <div className="flex-1 overflow-y-auto max-h-[360px] divide-y divide-border border border-border rounded-xl">
            {loadingShops ? (
              <div className="p-6 text-center text-xs text-slate-400">Loading shop roster…</div>
            ) : shops.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">No shops found.</div>
            ) : (
              shops.map((shop) => (
                <div key={shop.id} className="p-2.5 hover:bg-subtle transition flex items-center justify-between text-xs">
                  <div>
                    <div className="font-semibold text-foreground">{shop.shop_name}</div>
                    <div className="text-[10px] text-slate-500">
                      {shop.shop_code} · {shop.owner_name}
                    </div>
                  </div>
                  <span className="font-mono text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                    {shop.phone_number}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-border shadow-2xs overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between bg-subtle">
          <div className="flex items-center space-x-2">
            <FileText className="w-4 h-4 text-primary" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">
              Recent WhatsApp Dispatch Log
            </h3>
          </div>
          <button
            type="button"
            onClick={loadOutbox}
            className="text-xs text-slate-600 hover:text-slate-900 flex items-center space-x-1"
          >
            <span>Reload Logs</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-border bg-slate-50 text-[10px] font-semibold uppercase text-slate-500 tracking-wider">
                <th className="p-3">Recipient</th>
                <th className="p-3">Shop Name</th>
                <th className="p-3">WhatsApp Message Content</th>
                <th className="p-3">Status</th>
                <th className="p-3">Dispatched At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loadingOutbox && outbox.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-slate-400">Loading audit log…</td>
                </tr>
              ) : outbox.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-slate-400">No dispatch records found.</td>
                </tr>
              ) : (
                outbox.map((row) => (
                  <tr key={row.id} className="hover:bg-subtle">
                    <td className="p-3 font-mono font-semibold text-foreground">
                      {row.recipient_phone}
                    </td>
                    <td className="p-3 text-slate-700">
                      {row.collection?.shop_name || 'Bismillah Dairy Center'}
                    </td>
                    <td className="p-3 max-w-sm">
                      <div className="p-2 rounded-lg bg-slate-50 border border-slate-200 text-[11px] font-mono text-slate-800 whitespace-pre-line wrap-break-word">
                        {row.message_body}
                      </div>
                    </td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase bg-emerald-100 text-emerald-800 inline-flex items-center space-x-1">
                        <CheckCircle2 className="w-2.5 h-2.5 mr-1" />
                        <span>{row.status}</span>
                      </span>
                    </td>
                    <td className="p-3 text-[11px] text-slate-500">
                      {new Date(row.created_at).toLocaleString()}
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
}
