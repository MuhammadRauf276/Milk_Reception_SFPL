'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminLabTestsPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/super-admin/lab-tests');
  }, [router]);

  return (
    <div className="p-8 text-xs font-mono font-bold text-slate-500">
      Redirecting to Super Admin Lab Test Master...
    </div>
  );
}
