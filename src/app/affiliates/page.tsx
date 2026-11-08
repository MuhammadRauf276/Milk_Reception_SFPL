'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  Users,
  CheckCircle2,
  Award,
  Sparkles,
  TrendingUp,
  Share2,
  Copy,
  ArrowRight,
  ShieldCheck,
  Building2,
  Truck,
  FileCheck2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/frontend/lib/appToast';

const TIERS = [
  {
    name: 'Silver Partner',
    volume: 'Up to 5,000 L / day',
    incentive: 'Base commercial rate + 0.5% quality rebate',
    color: 'border-slate-300 bg-slate-50 text-slate-800',
    badge: 'Tier 1',
  },
  {
    name: 'Gold Associate',
    volume: '5,000 – 20,000 L / day',
    incentive: '+1.5% premium pricing + dedicated bay priority',
    color: 'border-amber-400 bg-amber-50 text-amber-900',
    badge: 'Tier 2 · Popular',
  },
  {
    name: 'Platinum Fleet',
    volume: '20,000+ L / day',
    incentive: '+3.0% incentive + zero detention demurrage waiver',
    color: 'border-indigo-400 bg-indigo-50 text-indigo-900',
    badge: 'Tier 3 · Enterprise',
  },
];

export default function AffiliatesPage() {
  const [copied, setCopied] = useState(false);
  const [partnerType, setPartnerType] = useState<'SUPPLIER' | 'TRANSPORTER'>('SUPPLIER');
  const [orgName, setOrgName] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [estVolume, setEstVolume] = useState('');
  const [referralCode, setReferralCode] = useState('MILK-REF-2026');
  const [submitted, setSubmitted] = useState(false);

  const handleCopyLink = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(`https://milk.shakarganj.com.pk/affiliates?ref=${referralCode}`);
      setCopied(true);
      toast.success('Referral invitation link copied to clipboard!');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleOnboardingSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgName.trim() || !contactName.trim() || !phone.trim()) {
      toast.error('Please complete all required fields.');
      return;
    }
    setSubmitted(true);
    toast.success('Partner application submitted for management onboarding review!');
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col w-full">
      {/* Top Bar */}
      <header className="flex h-16 w-full items-center justify-between border-b bg-card px-4 sm:px-8">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-primary" />
          <span className="font-bold text-base tracking-tight">Shakarganj Dairy · Partner & Affiliate Network</span>
        </div>
        <Link href="/" className="text-xs font-semibold text-primary hover:underline">
          Return to Workspace →
        </Link>
      </header>

      <main className="flex-1 w-full max-w-5xl mx-auto p-4 sm:p-8 space-y-8">
        {/* Hero Section */}
        <div className="rounded-2xl border border-border bg-card p-6 sm:p-10 shadow-xs space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Milk Procurement & Logistics Affiliates</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            Grow Your Dairy Supply Chain Partnership
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Register as a direct commercial supplier, local collection point associate, or contracted milk transporter.
            Earn volume tiers, transparency rebates, and zero-detention scale priority across all plant silos and ZMCC intake hubs.
          </p>

          {/* Referral Card */}
          <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-input bg-muted/50 font-mono text-xs font-semibold text-foreground">
              <Share2 className="w-4 h-4 text-muted-foreground" />
              <span>Invite Code: <strong>{referralCode}</strong></span>
            </div>
            <Button onClick={handleCopyLink} variant="outline" className="text-xs font-semibold gap-1.5 min-h-[40px]">
              {copied ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Copied' : 'Copy Partner Referral Link'}
            </Button>
          </div>
        </div>

        {/* Tier Based UI Indicators */}
        <div className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Tier-Based Volume & Quality Rebates
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {TIERS.map((tier) => (
              <div key={tier.name} className={`p-5 rounded-2xl border ${tier.color} space-y-3 shadow-2xs`}>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-white/70 border border-current/20">
                    {tier.badge}
                  </span>
                  <Award className="w-4 h-4 opacity-70" />
                </div>
                <div>
                  <h3 className="text-base font-bold">{tier.name}</h3>
                  <p className="text-xs font-medium opacity-80 mt-0.5">{tier.volume}</p>
                </div>
                <p className="text-xs font-semibold border-t border-current/15 pt-2.5">
                  {tier.incentive}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Onboarding Data Capture Form */}
        <div className="rounded-2xl border border-border bg-card p-6 sm:p-8 shadow-xs space-y-6">
          <div>
            <h2 className="text-lg font-bold text-foreground">Partner Onboarding Data Capture</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Submit your organization credentials for automated verification and route assignment.
            </p>
          </div>

          {submitted ? (
            <div className="p-8 text-center border border-dashed border-emerald-300 bg-emerald-50/50 rounded-xl space-y-2">
              <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
              <h3 className="text-sm font-bold text-emerald-950">Application Successfully Logged</h3>
              <p className="text-xs text-emerald-800 max-w-md mx-auto">
                Your partnership intake file has been dispatched to MPD Governance and the Zonal Field Operations team.
                You will receive your dispatch token and route clearance via SMS & WhatsApp.
              </p>
              <Button onClick={() => setSubmitted(false)} variant="outline" size="sm" className="mt-3 text-xs">
                Submit Another Intake
              </Button>
            </div>
          ) : (
            <form onSubmit={handleOnboardingSubmit} className="space-y-4">
              {/* Partner Type Selection */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setPartnerType('SUPPLIER')}
                  className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-xl border text-xs font-bold transition ${
                    partnerType === 'SUPPLIER'
                      ? 'border-primary ring-1 ring-primary bg-primary/5 text-primary'
                      : 'border-border bg-card text-muted-foreground hover:bg-muted/40'
                  }`}
                >
                  <Building2 className="w-4 h-4" />
                  <span>Commercial Milk Supplier</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPartnerType('TRANSPORTER')}
                  className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-xl border text-xs font-bold transition ${
                    partnerType === 'TRANSPORTER'
                      ? 'border-primary ring-1 ring-primary bg-primary/5 text-primary'
                      : 'border-border bg-card text-muted-foreground hover:bg-muted/40'
                  }`}
                >
                  <Truck className="w-4 h-4" />
                  <span>Contracted Transporter</span>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    Organization / Farm Name <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    placeholder="e.g. Al-Razi Dairy Farms"
                    className="w-full min-h-[44px] px-3.5 text-xs rounded-xl border border-input bg-card text-foreground focus:ring-2 focus:ring-ring/30 focus:border-primary"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    Primary Contact Person <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    placeholder="e.g. Muhammad Rauf"
                    className="w-full min-h-[44px] px-3.5 text-xs rounded-xl border border-input bg-card text-foreground focus:ring-2 focus:ring-ring/30 focus:border-primary"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    Phone / WhatsApp Number <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="e.g. +92 300 1234567"
                    className="w-full min-h-[44px] px-3.5 text-xs rounded-xl border border-input bg-card text-foreground focus:ring-2 focus:ring-ring/30 focus:border-primary"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    Estimated Daily Liters
                  </label>
                  <input
                    type="number"
                    value={estVolume}
                    onChange={(e) => setEstVolume(e.target.value)}
                    placeholder="e.g. 10000"
                    className="w-full min-h-[44px] px-3.5 text-xs rounded-xl border border-input bg-card text-foreground focus:ring-2 focus:ring-ring/30 focus:border-primary"
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <Button type="submit" className="min-h-[44px] px-6 text-xs font-bold gap-2">
                  <FileCheck2 className="w-4 h-4" />
                  <span>Submit Partner Onboarding</span>
                </Button>
              </div>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
