'use client';

import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Image from 'next/image';
import {
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
import { InfoTip } from '@/components/ui/info-tip';
import { confirmAction } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import { SkeletonList } from '@/components/ui/loaders';
import { formatDateTime } from '@/lib/format';
import { formatLabel } from '@/lib/format';

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

const outboxColumns: DataColumn<OutboxItem>[] = [
  { key: 'recipient', header: 'Recipient', label: 'Recipient', primary: true, cell: (row) => <span className="whitespace-nowrap font-mono font-semibold text-foreground">{row.recipient_phone}</span> },
  { key: 'shop', header: 'Shop name', label: 'Shop name', cell: (row) => <span className="text-secondary-foreground">{row.collection?.shop_name || 'Bismillah Dairy Center'}</span> },
  {
    key: 'message',
    header: 'Message',
    label: 'Message',
    cell: (row) => (
      <div className="max-w-sm whitespace-pre-line break-words rounded-lg border border-border bg-card p-2 font-mono text-xs text-foreground">{row.message_body}</div>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    label: 'Status',
    cell: (row) => (
      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
        <CheckCircle2 className="h-3 w-3" />
        {formatLabel(row.status)}
      </span>
    ),
  },
  { key: 'sent', header: 'Sent at', label: 'Sent at', cell: (row) => <span className="tabular-nums text-muted-foreground">{formatDateTime(row.created_at)}</span> },
];

export default function SuperAdminWhatsAppPage() {
  const queryClient = useQueryClient();

  // Shop selection and compose state
  const [targetMode, setTargetMode] = useState<'SINGLE' | 'ALL_USER'>('ALL_USER');
  const [pickedShopId, setPickedShopId] = useState<string>('');

  const [messageText, setMessageText] = useState<string>(
    '*Shakarganj Milk Reception Receipt*\n*Shop:* Bismillah Dairy Collection Center\n*RMR No:* 005102 | *Journey:* #JRN-HAS-20261007-001\n*Vehicle:* LES-19-4821 | *Mobile Tester:* Muhammad Tariq\n*Gross Qty:* 210.00 L\n*LR:* 29.0 | *Fat:* 4.1%\n*SNF:* 8.52% | *Total Solids:* 12.60%\n*@13 TS:* 203.86 L\n*Status:* Verified & Dispatched via Super Admin\n_Shakarganj Food Products Ltd, Field Reception_'
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
    if (!(await confirmAction({ title: 'Disconnect WhatsApp?', description: 'You will need to scan the QR code again.', confirmLabel: 'Disconnect', destructive: true }))) {
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
        `*Shakarganj Milk Reception Receipt*\n*Shop:* ${sName}\n*RMR No:* 005102 | *Journey:* #JRN-HAS-20261007-001\n*Vehicle:* LES-19-4821 | *Mobile Tester:* Muhammad Tariq\n*Gross Qty:* 210.00 L\n*LR:* 29.0 | *Fat:* 4.1%\n*SNF:* 8.52% | *Total Solids:* 12.60%\n*@13 TS:* 203.86 L\n*Status:* Verified & Dispatched Automatically\n_Shakarganj Food Products Ltd, Field Reception_`
      );
    } else if (type === 'RATE') {
      setMessageText(
        `*Shakarganj Milk Rate Announcement*\nDear ${oName} (${sName}),\nToday's milk procurement base rate has been updated. Quality incentives apply automatically based on TS analysis.\n_Shakarganj Food Products Ltd, Field Operations_`
      );
    } else if (type === 'CHILLING') {
      setMessageText(
        `*Shakarganj Milk Quality Advisory*\nDear ${oName} (${sName}),\nPlease pre-chill all collected milk below 4°C before the Mobile Tester vehicle arrives. This qualifies your shop for cold-chain quality bonuses.\n_Shakarganj Quality Assurance Desk_`
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
          message: `Message sent to ${targetPhone} (ID: ${data.messageId || 'sent'})`,
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
    <div className="w-full min-w-0 max-w-full space-y-6 animate-panel-in">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <p className="min-w-0 text-sm text-muted-foreground">Send receipts and notices to shops</p>
        <Button variant="outline" onClick={() => fetchGatewayStatus()} disabled={refreshing}>
          Refresh
        </Button>
      </div>

      <div className="bg-card rounded-2xl border border-border shadow-2xs p-5 sm:p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex min-w-0 items-center space-x-3.5">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center ${
              isConnected ? 'text-emerald-700' : isScanQr ? 'text-amber-700' : 'text-rose-700'
            }`}
          >
            {isConnected ? (
              <ShieldCheck className="w-6 h-6" />
            ) : isScanQr ? (
              <QrCode className="w-6 h-6" />
            ) : (
              <AlertTriangle className="w-6 h-6" />
            )}
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-foreground">
                {isConnected
                  ? 'Connected'
                  : isScanQr
                  ? 'Scan QR code'
                  : 'Gateway offline'}
              </h2>
              <span
                className={`rounded-md px-3 py-0.5 text-xs font-semibold ${
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
            <p className="text-xs text-secondary-foreground mt-0.5 flex items-center">
              {isConnected
                ? `${gateway?.user?.name || 'Shakarganj Milk Reception'} (${gateway?.user?.id || 'Connected'})`
                : isScanQr
                ? 'Scan below'
                : 'Not running'}
              {!isConnected && !isScanQr ? <InfoTip text={'Run "npm run whatsapp:gateway" to start the background WhatsApp daemon.'} /> : null}
            </p>
          </div>
        </div>

        {isConnected && (
          <Button variant="outline" onClick={handleDisconnect} className="self-start md:self-auto">
            <LogOut />
            Disconnect
          </Button>
        )}
      </div>

      {isScanQr && gateway?.qr && (
        <div className="bg-card rounded-2xl border border-border shadow-2xs p-6 grid grid-cols-1 md:grid-cols-2 gap-6 items-center animate-panel-in">
          <div className="flex flex-col items-center justify-center p-4 bg-card border border-border rounded-2xl space-y-2">
            <div className="p-3 bg-card rounded-xl shadow-md border border-border">
              <Image
                src={gateway.qr}
                alt="WhatsApp QR Code"
                width={220}
                height={220}
                unoptimized
                className="w-56 h-56 rounded-lg"
              />
            </div>
            <div className="text-xs font-semibold text-emerald-700 flex items-center space-x-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>Waiting for scan</span>
            </div>
          </div>

          <div className="space-y-3 text-xs text-secondary-foreground">
            <h3 className="font-semibold text-sm text-foreground">Steps</h3>
            <ol className="list-decimal list-inside space-y-2 text-secondary-foreground pl-1 font-medium">
              <li>Open WhatsApp on the phone with the Shakarganj logo profile.</li>
              <li>Tap Settings / ⋮ &gt; <strong>Linked Devices</strong>.</li>
              <li>Tap <strong>Link a Device</strong> and point your camera at the QR code.</li>
            </ol>
            <div className="text-xs text-secondary-foreground flex items-center">Branding<InfoTip text="Once linked, all dairy shops receive messages from this account with your Shakarganj profile name and logo." /></div>
          </div>
        </div>
      )}

      <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-7 min-w-0 bg-card rounded-2xl border border-border shadow-2xs p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground flex items-center space-x-2">
                <Send className="w-4 h-4 text-muted-foreground" />
                <span>Send message</span>
              </h3>
            </div>
            <span className="text-xs font-semibold px-3 py-1 bg-card text-secondary-foreground border border-border rounded-lg">
              03176826604
            </span>
          </div>

          {dispatchResult && (
            <div
              className={`p-4 rounded-xl border text-xs font-semibold flex items-center space-x-2 animate-panel-in ${
                dispatchResult.success
                  ? 'bg-card border-border text-emerald-900'
                  : 'bg-card border-border text-rose-900'
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
              <label className="block text-xs font-semibold text-secondary-foreground mb-2">
                Send to
              </label>
              <div className="mb-2 grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-2">
                <button
                  type="button"
                  onClick={() => setTargetMode('ALL_USER')}
                  className={`min-h-11 rounded-xl border p-3 text-left text-xs font-medium transition-colors flex items-center space-x-2 ${
                    targetMode === 'ALL_USER'
                      ? 'border-primary bg-card text-foreground ring-1 ring-primary'
                      : 'border-border bg-card text-secondary-foreground hover:bg-subtle'
                  }`}
                >
                  <Radio className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div>
                    <div className="font-semibold">Demo shops ({userShops.length || 14})</div>
                    <div className="text-xs text-muted-foreground font-mono">03176826604</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setTargetMode('SINGLE')}
                  className={`min-h-11 rounded-xl border p-3 text-left text-xs font-medium transition-colors flex items-center space-x-2 ${
                    targetMode === 'SINGLE'
                      ? 'border-primary bg-card text-foreground ring-1 ring-primary'
                      : 'border-border bg-card text-secondary-foreground hover:bg-subtle'
                  }`}
                >
                  <Store className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div>
                    <div className="font-semibold">One shop</div>
                    
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
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <label className="text-xs font-semibold text-secondary-foreground">
                  Templates
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleApplyTemplate('RECEIPT')}
                    className="min-h-11 rounded-lg border border-border bg-card px-3 text-xs font-medium text-secondary-foreground transition-colors hover:bg-subtle"
                  >
                    Collection receipt
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyTemplate('RATE')}
                    className="min-h-11 rounded-lg border border-border bg-card px-3 text-xs font-medium text-secondary-foreground transition-colors hover:bg-subtle"
                  >
                    Rate advisory
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyTemplate('CHILLING')}
                    className="min-h-11 rounded-lg border border-border bg-card px-3 text-xs font-medium text-secondary-foreground transition-colors hover:bg-subtle"
                  >
                    Chilling alert
                  </button>
                </div>
              </div>

              <textarea
                rows={6}
                required
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                placeholder="Type the message"
                className="w-full text-xs font-mono border border-border rounded-xl p-3 bg-card text-foreground focus:border-primary outline-hidden leading-relaxed shadow-2xs"
              />
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <span className="flex items-center">Formatting<InfoTip text="Supports WhatsApp formatting: *bold*, _italics_" /></span>
                <span>{messageText.length} characters</span>
              </div>
            </div>

            <Button type="submit" disabled={isSending || !isConnected} className="w-full">
              <Send />
              <span>
                {isSending
                  ? 'Sending…'
                  : !isConnected
                  ? 'Not connected'
                  : 'Send message'}
              </span>
            </Button>
          </form>
        </div>

        <div className="lg:col-span-5 min-w-0 bg-card rounded-2xl border border-border shadow-2xs p-5 sm:p-6 space-y-4 flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
            <h3 className="text-sm font-semibold text-foreground flex items-center space-x-2">
              <Users className="w-4 h-4 text-muted-foreground" />
              <span>Shops</span>
            </h3>
            <span className="text-xs font-semibold text-secondary-foreground bg-card border border-border px-2 py-0.5 rounded-md">
              03176826604
            </span>
          </div>

          <p className="text-xs text-muted-foreground flex items-center">Sent to your number<InfoTip text="All active Hasilpur demonstration shops are set to this number." /></p>

          <div className="max-h-90 min-w-0 flex-1 overflow-y-auto divide-y divide-border border border-border rounded-xl">
            {loadingShops ? (
              <SkeletonList count={3} className="p-2" />
            ) : shops.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground">No shops found.</div>
            ) : (
              shops.map((shop) => (
                <div key={shop.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-xs transition-colors hover:bg-subtle">
                  <div className="min-w-0">
                    <div className="font-semibold text-foreground">{shop.shop_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {shop.shop_code} · {shop.owner_name}
                    </div>
                  </div>
                  <span className="rounded-md border border-border bg-card px-2 py-0.5 font-mono text-xs font-semibold text-secondary-foreground">
                    {shop.phone_number}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-subtle p-4">
          <div className="flex items-center space-x-2">
            <FileText className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Dispatch log</h3>
          </div>
          <Button variant="ghost" size="sm" onClick={loadOutbox}>
            Reload
          </Button>
        </div>

        <div className="p-3 sm:p-4">
          <DataTable
            columns={outboxColumns}
            rows={outbox}
            getRowId={(row) => row.id}
            loading={loadingOutbox && outbox.length === 0}
            emptyTitle="No dispatch records"
            tableFrom="lg"
          />
        </div>
      </div>
    </div>
  );
}
