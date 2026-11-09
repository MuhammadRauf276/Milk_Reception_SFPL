'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Building2, CheckCircle2, Copy, Info, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { toast } from '@/frontend/lib/appToast';

const PARTNER_TYPES = [
  { value: 'SUPPLIER', label: 'Milk supplier', icon: Building2 },
  { value: 'TRANSPORTER', label: 'Transporter', icon: Truck },
] as const;

/**
 * Partner page. Registration has no backend yet, so the page says so plainly
 * and sends nothing. Terms and rates are added only once the business confirms them.
 */
export default function AffiliatesPage() {
  const [copied, setCopied] = useState(false);
  const [partnerType, setPartnerType] = useState<'SUPPLIER' | 'TRANSPORTER'>('SUPPLIER');
  const [orgName, setOrgName] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [estVolume, setEstVolume] = useState('');

  const handleCopyLink = () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    void navigator.clipboard.writeText(`${window.location.origin}/affiliates`);
    setCopied(true);
    toast.success('Link copied');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex min-h-[100dvh] w-full flex-col bg-background text-foreground">
      <header className="flex min-h-16 w-full flex-wrap items-center justify-between gap-2 border-b bg-card px-4 sm:px-6">
        <span className="text-base font-semibold">Shakarganj milk partners</span>
        <Link href="/" className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline">
          Back to workspace
        </Link>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 space-y-4 p-4 sm:p-6">
        <div className="space-y-3 rounded-2xl border bg-card p-4 shadow-2xs sm:p-6">
          <h1 className="text-xl font-semibold">Become a partner</h1>
          <p className="text-sm text-muted-foreground">For milk suppliers and transporters.</p>
          <Button onClick={handleCopyLink} variant="outline">
            {copied ? <CheckCircle2 /> : <Copy />}
            {copied ? 'Copied' : 'Copy link to this page'}
          </Button>
        </div>

        <div role="status" className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0">Online registration is not open yet. Nothing on this form is sent or saved.</span>
        </div>

        <form onSubmit={(e) => e.preventDefault()} className="space-y-4 rounded-2xl border bg-card p-4 shadow-2xs sm:p-6">
          <h2 className="text-base font-semibold">Your details</h2>

          <div role="group" aria-label="Partner type" className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-2">
            {PARTNER_TYPES.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                aria-pressed={partnerType === value}
                onClick={() => setPartnerType(value)}
                className={`flex min-h-11 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors ${
                  partnerType === value ? 'border-primary bg-accent text-accent-foreground' : 'border-input bg-card text-secondary-foreground hover:bg-muted'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-4">
            <FormField label="Organization or farm" htmlFor="partner-org">
              <Input id="partner-org" value={orgName} onChange={(e) => setOrgName(e.target.value)} />
            </FormField>
            <FormField label="Contact person" htmlFor="partner-contact">
              <Input id="partner-contact" value={contactName} onChange={(e) => setContactName(e.target.value)} />
            </FormField>
            <FormField label="Phone or WhatsApp" htmlFor="partner-phone">
              <Input id="partner-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </FormField>
            <FormField label="Estimated litres per day" htmlFor="partner-volume">
              <Input id="partner-volume" type="number" inputMode="numeric" value={estVolume} onChange={(e) => setEstVolume(e.target.value)} />
            </FormField>
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled>
              Registration not open yet
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
}
