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
    if (!confirm('Are you sure you want to disconnect this WhatsApp account? You will need to re-scan the QR code.')) {
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
    <div className="min-h-screen bg-slate-50 text-foreground flex flex-col">
      <header className="bg-white border-b border-border shadow-2xs sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Link
              href="/phe?section=mot&view=sms"
              className="p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-subtle transition"
              title="Return to MOT Receipts"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div className="flex items-center space-x-2.5">
              <div className="p-2 bg-emerald-600 text-white rounded-xl shadow-2xs">
                <MessageSquare className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-sm sm:text-base font-bold text-foreground">
                  WhatsApp gateway
                </h1>
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={() => fetchStatus(false)}
              disabled={refreshing}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border border-border bg-white text-xs font-semibold text-slate-700 hover:bg-subtle transition shadow-2xs"
            >
              <span>Refresh</span>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto p-4 sm:p-6 space-y-6">
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
                    ? 'Action Required: Scan QR Code'
                    : 'Gateway Disconnected or Starting'}
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
                  ? `Authenticated as: ${gateway?.user?.name || 'Shakarganj Milk Reception'} (${gateway?.user?.id || 'Active Session'})`
                  : isScanQr
                  ? 'Link any phone or WhatsApp Business account with the Shakarganj logo.'
                  : gateway?.message || 'Connecting to internal WebSocket daemon on port 3001…'}
              </p>
            </div>
          </div>

          {isConnected && (
            <button
              type="button"
              disabled={loggingOut}
              onClick={handleLogout}
              className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-800 text-xs font-semibold transition shadow-2xs self-start md:self-auto"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>{loggingOut ? 'Disconnecting…' : 'Disconnect Account'}</span>
            </button>
          )}
        </div>

        {isScanQr && gateway?.qr && (
          <div className="bg-white rounded-2xl border border-border shadow-2xs overflow-hidden">
            <div className="p-5 sm:p-6 border-b border-border bg-slate-50/50">
              <h3 className="text-sm font-bold text-foreground flex items-center space-x-2">
                <Smartphone className="w-4 h-4 text-primary" />
                <span>Link WhatsApp with Shakarganj Logo</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Scan this QR code using the WhatsApp app on the phone that has the Shakarganj logo and name set.
              </p>
            </div>

            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
              <div className="flex flex-col items-center justify-center p-6 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                <div className="p-3 bg-white rounded-xl shadow-md border border-slate-200">
                  <Image
                    src={gateway.qr}
                    alt="WhatsApp QR Code"
                    width={256}
                    height={256}
                    unoptimized
                    className="w-64 h-64 rounded-lg"
                  />
                </div>
                <div className="flex items-center space-x-1.5 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200 animate-pulse">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Waiting for scan… Status updates automatically</span>
                </div>
              </div>

              <div className="space-y-4 text-xs text-slate-700">
                <div className="font-bold text-sm text-foreground">How to Link in 3 Steps:</div>
                <ol className="list-decimal list-inside space-y-3 font-medium text-slate-600 pl-1">
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

                <div className="p-3.5 bg-blue-50 border border-blue-200 rounded-xl text-blue-950 text-[11px] space-y-1">
                  <div className="font-semibold text-blue-900 flex items-center space-x-1">
                    <Flame className="w-3.5 h-3.5 text-blue-700" />
                    <span>Tip for Shakarganj Logo:</span>
                  </div>
                  <p>
                    Set your WhatsApp profile picture to the Shakarganj logo and name to <strong className="font-semibold">Shakarganj Milk Reception</strong>. Shops will see the logo when receipts arrive.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {isConnected && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl border border-border shadow-2xs p-5 sm:p-6 space-y-4">
              <div className="border-b border-border pb-3">
                <h3 className="text-sm font-bold text-foreground flex items-center space-x-2">
                  <Send className="w-4 h-4 text-emerald-600" />
                  <span>Send Real Automated WhatsApp Test</span>
                </h3>
              </div>

              <form onSubmit={handleSendTest} className="space-y-3.5">
                {testResult && (
                  <div
                    className={`p-3 rounded-xl border text-xs font-semibold flex items-center space-x-2 animate-panel-in ${
                      testResult.success
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                        : 'bg-rose-50 border-rose-200 text-rose-900'
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
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Recipient Mobile Number
                  </label>
                  <input
                    type="text"
                    required
                    value={testPhone}
                    onChange={(e) => setTestPhone(e.target.value)}
                    placeholder="03176826604"
                    className="w-full text-xs font-medium border border-border rounded-xl p-2.5 bg-white text-foreground focus:ring-2 focus:ring-emerald-500 outline-hidden font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Message Content (WhatsApp Markdown)
                  </label>
                  <textarea
                    rows={4}
                    required
                    value={testMessage}
                    onChange={(e) => setTestMessage(e.target.value)}
                    className="w-full text-xs font-medium border border-border rounded-xl p-2.5 bg-white text-foreground focus:ring-2 focus:ring-emerald-500 outline-hidden font-mono leading-relaxed"
                  />
                </div>

                <button
                  type="submit"
                  disabled={sendingTest}
                  className="w-full flex items-center justify-center space-x-2 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-2xs transition disabled:opacity-50"
                >
                  <Send className={`w-3.5 h-3.5 ${sendingTest ? 'animate-pulse' : ''}`} />
                  <span>{sendingTest ? 'Sending via WhatsApp…' : 'Send Test WhatsApp Message'}</span>
                </button>
              </form>
            </div>

            <div className="bg-white rounded-2xl border border-border shadow-2xs p-5 sm:p-6 space-y-4">
              <div className="border-b border-border pb-3">
                <h3 className="text-sm font-bold text-foreground">
                  Automated Dispatch Status
                </h3>
              </div>

              <div className="space-y-3 text-xs text-slate-700">
                <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-xl flex items-start space-x-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-emerald-950 font-semibold">Automatic Field Dispatch: Active</strong>
                  </div>
                </div>

                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="text-slate-500">Gateway Port:</span>
                    <span className="font-mono font-semibold text-foreground">127.0.0.1:3001</span>
                  </div>
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="text-slate-500">Connected User:</span>
                    <span className="font-mono font-semibold text-foreground">
                      {gateway?.user?.name || 'Shakarganj'} ({gateway?.user?.id?.split('@')[0] || 'Active'})
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="text-slate-500">Encryption:</span>
                    <span className="font-semibold text-emerald-700">End-to-End Encrypted (E2EE)</span>
                  </div>
                </div>

                <div className="pt-2">
                  <Link
                    href="/phe?section=mot&view=sms"
                    className="inline-flex items-center space-x-1.5 text-xs font-semibold text-primary hover:underline"
                  >
                    <span>View WhatsApp Outbox Logs &rarr;</span>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        )}

        {isOffline && (
          <div className="bg-rose-50 border border-rose-200 rounded-2xl p-6 text-rose-900 space-y-3">
            <div className="flex items-center space-x-2 font-bold text-sm text-rose-950">
              <AlertTriangle className="w-5 h-5 text-rose-600" />
              <span>WhatsApp Service Daemon Not Running</span>
            </div>
            <p className="text-xs text-rose-800">
              The internal WhatsApp bridge is not responding on port 3001. You can start it from your terminal by running:
            </p>
            <div className="p-3 bg-slate-900 text-emerald-400 font-mono text-xs rounded-xl">
              npm run whatsapp:gateway
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
