'use client';

import React, { useState } from 'react';
import { Mail, Send, X, ExternalLink, MessageSquare, Check, Sparkles, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { fetchJson } from '@/lib/query/fetchJson';
import { getErrorMessage } from '@/lib/errors';
import type { DailyReportData } from '@/backend/services/superAdminDailyReportService';

interface SendReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  reportData: DailyReportData;
}

const PRESET_STAKEHOLDERS = [
  { label: 'Head of MPD', email: 'head.mpd@shakarganj.com.pk', role: 'HEAD_OF_MPD' },
  { label: 'AVP QA Reception', email: 'qa.head@shakarganj.com.pk', role: 'QA_HEAD' },
  { label: 'Operations Director', email: 'operations.director@shakarganj.com.pk', role: 'OPERATIONS' },
  { label: 'ZMCC Managers', email: 'zmcc.managers@shakarganj.com.pk', role: 'ZMCC_MANAGERS' },
];

export const SendReportModal: React.FC<SendReportModalProps> = ({ isOpen, onClose, reportData }) => {
  const [selectedEmails, setSelectedEmails] = useState<string[]>([PRESET_STAKEHOLDERS[0].email]);
  const [customEmail, setCustomEmail] = useState('');
  const [executiveNote, setExecutiveNote] = useState('');
  const [isSending, setIsSending] = useState(false);

  if (!isOpen) return null;

  const kpis = reportData.kpis;
  // ui-text-ignore
  const summaryText = `*SHAKARGANJ DAILY OPERATIONS & QUALITY REPORT (${reportData.date})*

📊 *Intake Volumes & Yields:* // ui-text-ignore
• MOT Village Intake: // ui-text-ignore ${kpis.mot.totalLiters.toLocaleString()} L (${kpis.mot.totalCollections} collections · ${kpis.mot.passedCount} passed · ${kpis.mot.warningCount} warnings · ${kpis.mot.rejectedCount} rejected)
• ZMCC Lab Intake: // ui-text-ignore ${kpis.zmcc.totalLiters.toLocaleString()} L (${kpis.zmcc.totalPortions} portions · ${kpis.zmcc.warningCount} warnings)
• Plant QA Reception: // ui-text-ignore ${kpis.plantQa.totalLiters.toLocaleString()} L (${kpis.plantQa.totalTankers} tankers · ${kpis.plantQa.acceptedCount} accepted · ${kpis.plantQa.mtdWarningEscalations} MTD warning escalations)

⚖️ *Exceptions & Loss Performance:* // ui-text-ignore
• Exceptions Handled: // ui-text-ignore ${kpis.exceptions.totalHandled} (${kpis.exceptions.approvedCount} approved · ${kpis.exceptions.rejectedCount} rejected)
• Tier 1 (MOT Route Loss): // ui-text-ignore ${kpis.losses.tier1LossPercent.toFixed(2)}%
• Tier 2 (ZMCC Chilling Loss): // ui-text-ignore ${kpis.losses.tier2LossPercent.toFixed(2)}%
• Tier 3 (Road Transit Loss): // ui-text-ignore ${kpis.losses.tier3LossPercent.toFixed(2)}%
${executiveNote ? `\n📝 *Executive Note:* ${executiveNote}` : ''} // ui-text-ignore
🔗 View & Export Complete Excel at: // ui-text-ignore /super-admin/daily-report?date=${reportData.date}`;

  const togglePreset = (email: string) => {
    setSelectedEmails((prev) =>
      prev.includes(email) ? prev.filter((e) => e !== email) : [...prev, email]
    );
  };

  const handleAddCustomEmail = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = customEmail.trim().toLowerCase();
    if (!clean) return;
    if (!clean.includes('@') || !clean.includes('.')) {
      toast.error('Please enter a valid email address.');
      return;
    }
    if (!selectedEmails.includes(clean)) {
      setSelectedEmails([...selectedEmails, clean]);
    }
    setCustomEmail('');
  };

  const handleDirectSend = async () => {
    if (selectedEmails.length === 0) {
      toast.error('Please select at least one recipient email.');
      return;
    }

    setIsSending(true);
    try {
      await fetchJson('/api/super-admin/daily-report/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipients: selectedEmails,
          date: reportData.date,
          note: executiveNote || undefined,
        }),
      });

      toast.success(`Daily Report email dispatched to ${selectedEmails.length} recipient(s).`);
      onClose();
    } catch (err) {
      toast.error(getErrorMessage(err) || 'Failed to dispatch email.');
    } finally {
      setIsSending(false);
    }
  };

  const handleOpenGmail = () => {
    if (selectedEmails.length === 0) {
      toast.error('Please select at least one recipient email.');
      return;
    }
    const to = encodeURIComponent(selectedEmails.join(', '));
    const subject = encodeURIComponent(`Daily Operations & Quality Report - ${reportData.date}`);
    const body = encodeURIComponent(summaryText);
    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${to}&su=${subject}&body=${body}`;
    window.open(gmailUrl, '_blank', 'noopener,noreferrer');
  };

  const handleShareWhatsApp = () => {
    const text = encodeURIComponent(summaryText);
    const waUrl = `https://api.whatsapp.com/send?text=${text}`;
    window.open(waUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="flex max-h-[92vh] w-full max-w-xl flex-col rounded-2xl border border-slate-200 bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-primary">
              <Mail className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">Send Daily Report to Executives</h2>
              <p className="text-xs text-slate-500">Dispatch report summary via Email, Gmail, or WhatsApp</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto p-5 text-xs">
          {/* Recipient Selection */}
          <div>
            <label className="mb-1.5 block font-bold text-slate-800">Select Recipients</label>
            <div className="flex flex-wrap gap-1.5">
              {PRESET_STAKEHOLDERS.map((s) => {
                const active = selectedEmails.includes(s.email);
                return (
                  <button
                    key={s.email}
                    type="button"
                    onClick={() => togglePreset(s.email)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
                      active
                        ? 'border-primary bg-primary text-white'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {active && <Check className="h-3 w-3" />}
                    <span>{s.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom Email Input */}
          <form onSubmit={handleAddCustomEmail} className="flex gap-2">
            <input
              type="email"
              value={customEmail}
              onChange={(e) => setCustomEmail(e.target.value)}
              placeholder="Add another email address (e.g. director@shakarganj.com.pk)…"
              className="h-9 flex-1 rounded-lg border border-slate-200 px-3 text-xs placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              type="submit"
              className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 font-bold text-slate-700 hover:bg-slate-50"
            >
              Add
            </button>
          </form>

          {/* Active Email Tags */}
          {selectedEmails.length > 0 && (
            <div className="flex flex-wrap gap-1.5 rounded-lg bg-slate-50 p-2.5 border border-slate-200">
              <span className="text-[11px] font-bold text-slate-500 mr-1 self-center">Recipients:</span>
              {selectedEmails.map((email) => (
                <span
                  key={email}
                  className="inline-flex items-center gap-1 rounded-md bg-white border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-800 shadow-2xs"
                >
                  {email}
                  <button
                    type="button"
                    onClick={() => togglePreset(email)}
                    className="text-slate-400 hover:text-rose-600"
                  ><X className="w-3 h-3" /></button>
                </span>
              ))}
            </div>
          )}

          {/* Executive Note */}
          <div>
            <label className="mb-1 block font-bold text-slate-800">Executive Remarks / Note (Optional)</label>
            <textarea
              rows={2}
              value={executiveNote}
              onChange={(e) => setExecutiveNote(e.target.value)}
              placeholder="e.g. All ZMCC chilling silos operating at target ≤ 4°C. MOT Route 2 delayed by 30 mins due to fog."
              className="w-full resize-none rounded-lg border border-slate-200 p-2 text-xs focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Live Preview of Email Body */}
          <div>
            <label className="mb-1 block font-bold text-slate-800">Dispatch Summary Preview</label>
            <pre className="max-h-44 overflow-y-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] text-slate-700 leading-relaxed">
              {summaryText}
            </pre>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleOpenGmail}
              disabled={isSending}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              title="Open pre-filled in Gmail"
            >
              <ExternalLink className="h-3.5 w-3.5 text-rose-600" />
              <span>Open in Gmail</span>
            </button>
            <button
              type="button"
              onClick={handleShareWhatsApp}
              disabled={isSending}
              className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
              title="Share report summary via WhatsApp"
            >
              <MessageSquare className="h-3.5 w-3.5 text-emerald-600" />
              <span>WhatsApp</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSending}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDirectSend}
              disabled={isSending || selectedEmails.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-bold text-white shadow-2xs hover:bg-primary-hover disabled:opacity-50 transition"
            >
              {isSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              <span>Send Email</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
