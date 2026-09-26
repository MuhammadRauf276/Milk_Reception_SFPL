'use client';

import React from 'react';
import { MilkTestPolicyWorkspace } from '../policy/MilkTestPolicyWorkspace';
import { Sliders } from 'lucide-react';
import type { User } from '@core/types';

interface MpdPolicyScreenProps {
  currentUser?: User | null;
}

export const MpdPolicyScreen: React.FC<MpdPolicyScreenProps> = ({ currentUser }) => {
  return (
    <div className="space-y-6">
      {/* Policy Workspace Wrapper */}
      <div className="bg-white border border-[#EAE4D5] rounded-xl p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-[#1E3A8A] shrink-0">
            <Sliders className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-xs font-bold text-[#111311] uppercase tracking-wider">
              Upstream Milk Quality & Testing Policies Configuration
            </h2>
            <p className="text-xs text-slate-600 mt-1 leading-relaxed">
              Define and review mandatory test parameters, tolerance thresholds, and sampling frequencies for Local Suppliers (at ZMCC gate), MOT Routes (at village shops), ZMCC Bulk Silos, and Direct Plant Contractors.
            </p>
          </div>
        </div>
      </div>

      {/* Embedded MilkTestPolicyWorkspace */}
      <div className="bg-white border border-[#EAE4D5] rounded-xl p-4 shadow-sm">
        <MilkTestPolicyWorkspace currentUser={currentUser ?? null} />
      </div>
    </div>
  );
};
