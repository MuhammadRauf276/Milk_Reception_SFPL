'use client';

import React from 'react';
import { Settings, ShieldCheck, Server, Lock } from 'lucide-react';

export default function SuperAdminSettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-black text-[#111311]">System Architecture & Security Settings</h1>
        <p className="text-xs font-medium text-slate-500 mt-1">
          System operational configurations and database status overview.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white p-5 rounded-xl border border-[#EAE4D5] shadow-sm space-y-3">
          <h2 className="text-sm font-extrabold text-[#111311] flex items-center space-x-2">
            <Server className="w-4 h-4 text-[#1E3A8A]" />
            <span>Database Connection & Security</span>
          </h2>
          <div className="text-xs space-y-1.5 font-medium text-slate-700">
            <div>Database Engine: <strong className="font-mono text-slate-900">PostgreSQL (Prisma ORM)</strong></div>
            <div>Password Hashing: <strong className="font-mono text-emerald-800">bcryptjs (Salt Rounds: 10)</strong></div>
            <div>Session Tokens: <strong className="font-mono text-blue-900">Signed JWT (HS256 24h Expiration)</strong></div>
            <div>Chronology Validation: <strong className="font-mono text-emerald-800 font-bold">EXACT Timeline Enabled (0s clock skew)</strong></div>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-[#EAE4D5] shadow-sm space-y-3">
          <h2 className="text-sm font-extrabold text-[#111311] flex items-center space-x-2">
            <ShieldCheck className="w-4 h-4 text-[#1E3A8A]" />
            <span>Administrative Safeguards</span>
          </h2>
          <div className="text-xs space-y-1.5 font-medium text-slate-700">
            <div>Last Super Admin Protection: <strong className="font-mono text-emerald-800 font-bold">Active (Transactional)</strong></div>
            <div>Historical Operational Edits: <strong className="font-mono text-rose-800 font-bold">Blocked for Super Admin</strong></div>
            <div>Result Type Immutability: <strong className="font-mono text-emerald-800 font-bold">Active (Historical Protection)</strong></div>
            <div>Password Exposure in AuditLog: <strong className="font-mono text-emerald-800 font-bold">Disabled (Never Stored)</strong></div>
          </div>
        </div>
      </div>
    </div>
  );
}
