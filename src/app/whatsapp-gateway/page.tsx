'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  MessageSquare,
  ShieldCheck,
  Send,
  LogOut,
  AlertTriangle,
  CheckCircle2,
  QrCode,
  Smartphone,
  ArrowLeft,
  Flame,
  Loader2,
} from 'lucide-react';
import { getErrorMessage } from '@/lib/errors';
import { InfoTip } from '@/components/ui/info-tip';
import { confirmAction } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';

interface GatewayStatus {
  status: 'OFFLINE' | 'DISCONNECTED' | 'CONNECTING' | 'SCAN_QR' | 'CONNECTED';
  user?: { id: string; name: string } | null;
  qr?: string | null;
  timestamp?: string;
  message?: string;
}

export default function WhatsAppGatewayPage() {
  const [gateway, setGateway] = useState<GatewayStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [testPhone, setTestPhone] = useState<string>('03176826604');
  const [testMessage, setTestMessage] = useState<string>(
    '*Shakarganj Milk Reception Test*\nTest message from the Shakarganj Milk Reception Platform.\nStatus: Gateway operational'
  );
  const [sendingTest, setSendingTest] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{ success: boolean; text: string } | null>(null);
  const [loggingOut, setLoggingOut] = useState<boolean>(false);

  const fetchStatus = useCallback(async (isSilent = false) => {
    if (!isSilent) setRefreshing(true);
    try {
      const res = await fetch('/api/whatsapp/status', { cache: 'no-store' });
      const data: GatewayStatus = await res.json();
      setGateway(data);
    } catch (err) {
      setGateway({
        status: 'OFFLINE',
        message: getErrorMessage(err) || 'Failed to connect to gateway.',
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();

    // Poll status every 3 seconds while in SCAN_QR or CONNECTING state
    const interval = setInterval(() => {
      fetchStatus(true);
    }, 3000);

    return () => clearInterval(interval);
  }, [fetchStatus]);

  const handleSendTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testPhone.trim() || !testMessage.trim()) return;

    setSendingTest(true);
    setTestResult(null);

    try {
      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: testPhone.trim(),
          message: testMessage.trim(),
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setTestResult({
          success: true,
          text: `Message dispatched successfully to ${data.to}! (ID: ${data.messageId || 'sent'})`,
        });
      } else {
        setTestResult({
          success: false,
          text: data.error || 'Failed to dispatch WhatsApp message.',
        });
      }
    } catch (err) {
      setTestResult({
        success: false,
        text: getErrorMessage(err) || 'Network error while contacting gateway.',
      });
    } finally {
      setSendingTest(false);
    }
  };

  const handleLogout = async () => {
    if (!(await confirmAction({ title: 'Disconnect WhatsApp?', description: 'You will need to scan the QR code again.', confirmLabel: 'Disconnect', destructive: true }))) {
      return;
    }

    setLoggingOut(true);
    try {
      await fetch('/api/whatsapp/status', { method: 'POST' });
      await fetchStatus();
    } catch (err) {
      alert('Error disconnecting: ' + getErrorMessage(err));
    } finally {
      setLoggingOut(false);
    }
  };

  const isConnected = gateway?.status === 'CONNECTED';
  const isScanQr = gateway?.status === 'SCAN_QR';
  const isOffline = gateway?.status === 'OFFLINE' || gateway?.status === 'DISCONNECTED';

  return (
    <div className="min-h-screen bg-subtle text-foreground flex flex-col">
      <header className="bg-card border-b border-border shadow-2xs sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Link
              href="/phe?section=mot&view=sms"
              className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition"
              title="Return to Mobile Tester Receipts"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div className="flex items-center space-x-2.5">
              <div className="text-muted-foreground">
                <MessageSquare className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-sm sm:text-base font-semibold text-foreground">
                  WhatsApp gateway
                </h1>
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Button variant="outline" onClick={() => fetchStatus(false)} disabled={refreshing}>
              Refresh
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto p-4 sm:p-6 space-y-6">
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
                    : 'Not connected'}
                </h2>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
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
              <p className="text-xs text-secondary-foreground mt-0.5">
                {isConnected
                  ? `Signed in as: ${gateway?.user?.name || 'Shakarganj Milk Reception'} (${gateway?.user?.id || 'Active Session'})`
                  : isScanQr
                  ? 'Link any phone or WhatsApp Business account with the Shakarganj logo.'
                  : isOffline
                  ? 'Gateway offline'
                  : 'Connecting…'}
              </p>
            </div>
          </div>

          {isConnected && (
            <Button variant="outline" disabled={loggingOut} onClick={handleLogout} className="self-start md:self-auto">
              <LogOut />
              <span>{loggingOut ? 'Disconnecting…' : 'Disconnect'}</span>
            </Button>
          )}
        </div>

        {isScanQr && gateway?.qr && (
          <div className="bg-card rounded-2xl border border-border shadow-2xs overflow-hidden">
            <div className="p-5 sm:p-6 border-b border-border bg-subtle">
              <h3 className="text-sm font-semibold text-foreground flex items-center space-x-2">
                <Smartphone className="w-4 h-4 text-muted-foreground" />
                <span>Link phone</span>
              </h3>
            </div>

            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))] items-center gap-8 p-6">
              <div className="flex flex-col items-center justify-center p-6 bg-card border border-border rounded-2xl space-y-3">
                <div className="p-3 bg-card rounded-xl shadow-md border border-border">
                  <Image
                    src={gateway.qr}
                    alt="WhatsApp QR Code"
                    width={256}
                    height={256}
                    unoptimized
                    className="h-auto w-full max-w-64 rounded-lg"
                  />
                </div>
                <div className="flex items-center space-x-1.5 text-xs font-medium text-secondary-foreground">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Waiting for scan</span>
                </div>
              </div>

              <div className="space-y-4 text-xs text-secondary-foreground">
                <div className="font-semibold text-sm text-foreground">Steps</div>
                <ol className="list-decimal list-inside space-y-3 font-medium text-secondary-foreground pl-1">
                  <li className="leading-relaxed">
                    Open <strong className="text-foreground">WhatsApp</strong> or <strong className="text-foreground">WhatsApp Business</strong> on your mobile phone.
                  </li>
                  <li className="leading-relaxed">
                    Tap <strong className="text-foreground">Settings</strong> (iOS) or the three dots <strong className="text-foreground">⋮</strong> (Android) and tap <strong className="text-foreground">Linked Devices</strong>.
                  </li>
                  <li className="leading-relaxed">
                    Tap <strong className="text-foreground">Link a Device</strong> and point your camera at the QR code on the left.
                  </li>
                </ol>

                <div className="p-3.5 bg-card border border-border rounded-2xl text-secondary-foreground text-xs space-y-1">
                  <div className="font-semibold text-foreground flex items-center space-x-1">
                    <Flame className="w-3.5 h-3.5 text-muted-foreground" />
                    <span>Profile tip</span>
                    <InfoTip text="Set the WhatsApp profile picture to the Shakarganj logo and the name to Shakarganj Milk Reception. Shops will see it when receipts arrive." />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {isConnected && (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,20rem),1fr))] gap-6">
            <div className="bg-card rounded-2xl border border-border shadow-2xs p-5 sm:p-6 space-y-4">
              <div className="border-b border-border pb-3">
                <h3 className="text-sm font-semibold text-foreground flex items-center space-x-2">
                  <Send className="w-4 h-4 text-muted-foreground" />
                  <span>Send test</span>
                </h3>
              </div>

              <form onSubmit={handleSendTest} className="space-y-3.5">
                {testResult && (
                  <div
                    className={`p-3 rounded-xl border text-xs font-semibold flex items-center space-x-2 animate-panel-in ${
                      testResult.success
                        ? 'bg-card border-border text-emerald-900'
                        : 'bg-card border-border text-rose-900'
                    }`}
                  >
                    {testResult.success ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                    )}
                    <span>{testResult.text}</span>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-secondary-foreground mb-1">
                    Phone number
                  </label>
                  <input
                    type="text"
                    required
                    value={testPhone}
                    onChange={(e) => setTestPhone(e.target.value)}
                    placeholder="03176826604"
                    className="w-full text-xs font-medium border border-border rounded-xl p-2.5 bg-card text-foreground focus:border-primary outline-hidden font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-secondary-foreground mb-1">
                    Message
                  </label>
                  <textarea
                    rows={4}
                    required
                    value={testMessage}
                    onChange={(e) => setTestMessage(e.target.value)}
                    className="w-full text-xs font-medium border border-border rounded-xl p-2.5 bg-card text-foreground focus:border-primary outline-hidden font-mono leading-relaxed"
                  />
                </div>

                <Button type="submit" disabled={sendingTest} className="w-full">
                  <Send />
                  <span>{sendingTest ? 'Sending…' : 'Send test'}</span>
                </Button>
              </form>
            </div>

            <div className="bg-card rounded-2xl border border-border shadow-2xs p-5 sm:p-6 space-y-4">
              <div className="border-b border-border pb-3">
                <h3 className="text-sm font-semibold text-foreground">
                  Status
                </h3>
              </div>

              <div className="space-y-3 text-xs text-secondary-foreground">
                <div className="p-3 bg-card border border-border rounded-xl flex items-start space-x-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-foreground font-semibold">Automatic field dispatch: active</strong>
                  </div>
                </div>

                <div className="p-3 bg-card border border-border rounded-xl space-y-2">
                  <div className="flex flex-wrap justify-between items-center gap-x-2 text-xs">
                    <span className="text-muted-foreground">Gateway port:</span>
                    <span className="font-mono font-semibold text-foreground">127.0.0.1:3001</span>
                  </div>
                  <div className="flex flex-wrap justify-between items-center gap-x-2 text-xs">
                    <span className="text-muted-foreground">Connected user:</span>
                    <span className="font-mono font-semibold text-foreground">
                      {gateway?.user?.name || 'Shakarganj'} ({gateway?.user?.id?.split('@')[0] || 'Active'})
                    </span>
                  </div>
                  <div className="flex flex-wrap justify-between items-center gap-x-2 text-xs">
                    <span className="text-muted-foreground">Encryption:</span>
                    <span className="font-semibold text-emerald-700">End-to-end encrypted (E2EE)</span>
                  </div>
                </div>

                <div className="pt-2">
                  <Link
                    href="/phe?section=mot&view=sms"
                    className="inline-flex items-center space-x-1.5 text-xs font-semibold text-primary hover:underline"
                  >
                    <span>Outbox &rarr;</span>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        )}

        {isOffline && (
          <div className="bg-card border border-border rounded-2xl p-6 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1 font-semibold text-sm text-foreground">
              <AlertTriangle className="w-5 h-5 text-rose-600" />
              <span>Gateway offline</span>
              <InfoTip text={'Start it with "npm run whatsapp:gateway", then retry.'} />
            </div>
            <Button onClick={() => fetchStatus(false)} disabled={refreshing}>
              Retry
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
