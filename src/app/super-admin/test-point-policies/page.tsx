'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Sliders } from 'lucide-react';

export default function SuperAdminTestPointPoliciesRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/super-admin/test-policies');
  }, [router]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] p-6 text-center">
      <div className="bg-white border border-slate-200 rounded-2xl p-8 max-w-md shadow-xs space-y-4">
        <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto">
          <Sliders className="w-6 h-6" />
        </div>
        <h1 className="text-lg font-bold text-slate-900">
          Consolidated into Stage Policies &amp; Rules
        </h1>
        <p className="text-xs text-slate-600 leading-relaxed">
          The Test Matrix has been consolidated into the unified{' '}
          <span className="font-semibold text-slate-800">Stage Policies &amp; Rules</span> workspace.
          You can configure compulsory status, photo requirements, rules, and numeric ranges all in one place.
        </p>
        <Link
          href="/super-admin/test-policies"
          className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary text-white text-xs font-bold rounded-lg hover:bg-primary-hover transition-colors"
        >
          <span>Go to Stage Policies &amp; Rules</span>
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}
