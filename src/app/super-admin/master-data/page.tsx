'use client';

import React from 'react';
import { FolderTree, Database, Truck, FlaskConical } from 'lucide-react';
import Link from 'next/link';

export default function SuperAdminMasterDataPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-black text-[#111311]">Master Reference Data Directory</h1>
        <p className="text-xs font-medium text-slate-500 mt-1">
          Central management catalog for plant core reference entities.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link
          href="/super-admin/procurement-sources"
          className="p-5 bg-white rounded-xl border border-[#EAE4D5] hover:border-[#1E3A8A] transition space-y-2 group shadow-sm"
        >
          <div className="p-2.5 bg-blue-50 text-[#1E3A8A] w-fit rounded-lg group-hover:bg-[#1E3A8A] group-hover:text-white transition">
            <Truck className="w-5 h-5" />
          </div>
          <h3 className="font-extrabold text-sm text-[#111311]">Procurement Sources Master</h3>
          <p className="text-xs text-slate-500 font-medium">Manage ZMCC direct centers and contractor masters.</p>
        </Link>

        <Link
          href="/super-admin/silos"
          className="p-5 bg-white rounded-xl border border-[#EAE4D5] hover:border-[#1E3A8A] transition space-y-2 group shadow-sm"
        >
          <div className="p-2.5 bg-blue-50 text-[#1E3A8A] w-fit rounded-lg group-hover:bg-[#1E3A8A] group-hover:text-white transition">
            <Database className="w-5 h-5" />
          </div>
          <h3 className="font-extrabold text-sm text-[#111311]">Silo Storage Master</h3>
          <p className="text-xs text-slate-500 font-medium">Manage milk storage silo capacities and activation status.</p>
        </Link>

        <Link
          href="/super-admin/lab-tests"
          className="p-5 bg-white rounded-xl border border-[#EAE4D5] hover:border-[#1E3A8A] transition space-y-2 group shadow-sm"
        >
          <div className="p-2.5 bg-blue-50 text-[#1E3A8A] w-fit rounded-lg group-hover:bg-[#1E3A8A] group-hover:text-white transition">
            <FlaskConical className="w-5 h-5" />
          </div>
          <h3 className="font-extrabold text-sm text-[#111311]">Lab Test Master Catalog</h3>
          <p className="text-xs text-slate-500 font-medium">Manage 30 standard laboratory tests and display order.</p>
        </Link>
      </div>
    </div>
  );
}
