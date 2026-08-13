'use client';

import React, { useState, useEffect } from 'react';
import { Scale, X, CheckCircle2, ShieldAlert, Search, RefreshCw, Clock, FileText } from 'lucide-react';
import { User, MilkProcessLog } from '@core/types';

interface ReadyVisit {
  id: string;
  visit_number: string;
  vehicle_number: string;
  token_number: string | null;
  entry_timestamp: string | null;
  current_status: string;
  portion_count: number;
  accepted_portion_count: number;
  rejected_portion_count: number;
  accepted_declared_kg: number;
  plant_decision_summary: string;
  portions: Array<{
    id: string;
    portion_number: number;
    declared_quantity_kg: number;
    plant_decision: string;
    plant_rejection_reason: string | null;
  }>;
}

interface OpenTicket {
  id: string;
  visit_id: string;
  ticket_number: string;
  token_number: string | null;
  vehicle_number: string;
  gross_weight_kg: number;
  gross_timestamp: string | null;
  current_status: string;
}

interface SecurityWeightFormProps {
  isOpen?: boolean;
  onClose?: () => void;
  log?: MilkProcessLog | null;
  onSave?: (id: number, updates: Partial<MilkProcessLog>) => Promise<void>;
  currentUser?: User | null;
}

export const SecurityWeightForm: React.FC<SecurityWeightFormProps> = ({ isOpen = true, onClose }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [readyVisits, setReadyVisits] = useState<ReadyVisit[]>([]);
  const [openTickets, setOpenTickets] = useState<OpenTicket[]>([]);

  const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null);
  const [ticketNumber, setTicketNumber] = useState(`WT-${Math.floor(1000 + Math.random() * 9000)}`);
  const [grossWeight, setGrossWeight] = useState<number | ''>(32500);

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchScaleData();
  }, []);

  const fetchScaleData = async (queryStr = searchQuery) => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const [readyRes, openRes] = await Promise.all([
        fetch(`/api/scale/ready-for-gross?q=${encodeURIComponent(queryStr)}`),
        fetch('/api/scale/open-tickets'),
      ]);

      const readyData = await readyRes.json();
      const openData = await openRes.json();

      if (readyData.visits) {
        setReadyVisits(readyData.visits);
        if (readyData.visits.length > 0 && !selectedVisitId) {
          setSelectedVisitId(readyData.visits[0].id);
        }
      }
      if (openData.tickets) {
        setOpenTickets(openData.tickets);
      }
    } catch (err: any) {
      console.error('Failed to fetch scale data', err);
    } finally {
      setIsLoading(false);
    }
  };

  const selectedVisit = readyVisits.find((v) => v.id === selectedVisitId) || readyVisits[0] || null;

  const handleSubmitGrossWeight = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVisit) return;

    setIsSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch('/api/scale/gross-weight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitId: selectedVisit.id,
          ticketNumber: ticketNumber.trim().toUpperCase(),
          grossWeightKg: Number(grossWeight) || 0,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to record gross weight');

      setSuccessMsg(`✅ ${data.message}`);
      setTicketNumber(`WT-${Math.floor(1000 + Math.random() * 9000)}`);
      setSelectedVisitId(null);
      fetchScaleData();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isOpen === false) return null;

  return (
    <div className="space-y-6 text-[#111311]">
      {/* Top Banner Header */}
      <div className="p-5 rounded-2xl bg-[#EFE9D9] border border-[#C4B9A3] shadow-sm flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="p-3 bg-indigo-700 text-white rounded-xl shadow-sm">
            <Scale className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-xl font-extrabold tracking-tight text-[#111311]">Scale 1 Weighbridge Terminal</h2>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-indigo-900 text-white">
                WEIGHBRIDGE OPERATOR WORKSPACE
              </span>
            </div>
            <p className="text-xs text-[#334155] font-semibold mt-0.5">
              Record 1st weight (Gross Loaded KG) for QA-accepted vehicles before silo offloading.
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => fetchScaleData()}
            className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-[#F4EFE3] border border-[#C4B9A3] text-xs font-bold text-[#111311] hover:bg-amber-100/60 transition shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-indigo-700 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Refresh Scale</span>
          </button>
          {onClose && (
            <button onClick={onClose} className="p-2 rounded-xl bg-[#F4EFE3] hover:bg-rose-100 text-slate-600 hover:text-rose-700 border border-[#C4B9A3]">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {errorMsg && (
        <div className="p-3 text-xs font-bold rounded-xl bg-rose-50 text-rose-800 border border-rose-200 flex items-center space-x-2">
          <ShieldAlert className="w-4 h-4 shrink-0 text-rose-600" />
          <span>{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-3 text-xs font-bold rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 flex items-center space-x-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Two-Column Side-by-Side Split Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT COLUMN (5/12): READY FOR GROSS WEIGHING QUEUE */}
        <div className="lg:col-span-5 space-y-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-sm font-extrabold uppercase tracking-wider text-[#111311] flex items-center gap-2">
              <Scale className="w-4 h-4 text-indigo-700" />
              <span>Ready for Scale 1</span>
            </h3>
            <span className="text-xs font-mono font-bold text-slate-500">{readyVisits.length} Vehicles</span>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                fetchScaleData(e.target.value);
              }}
              placeholder="Search by token, visit #, or vehicle #..."
              className="w-full pl-9 pr-3 py-2 text-xs font-mono font-bold rounded-xl border border-[#C4B9A3] bg-[#EFE9D9] text-[#111311]"
            />
          </div>

          <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
            {readyVisits.length === 0 ? (
              <div className="p-8 text-center border border-dashed border-[#C4B9A3] rounded-2xl bg-[#EFE9D9] text-xs font-bold text-slate-500">
                No vehicles currently waiting for Scale 1 gross weighing.
              </div>
            ) : (
              readyVisits.map((v) => {
                const isSelected = selectedVisit?.id === v.id;
                return (
                  <div
                    key={`ready-${String(v.id)}`}
                    onClick={() => setSelectedVisitId(v.id)}
                    className={`p-3.5 rounded-xl border transition cursor-pointer space-y-1.5 ${
                      isSelected
                        ? 'bg-indigo-900 text-white border-indigo-950 shadow-md ring-2 ring-indigo-500/40'
                        : 'bg-[#EFE9D9] text-[#111311] border-[#C4B9A3] hover:bg-amber-100/60'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <span className="font-mono font-black text-sm tracking-tight">{v.vehicle_number}</span>
                        {v.token_number && (
                          <span className={`px-2 py-0.5 rounded text-[9.5px] font-black font-mono ${isSelected ? 'bg-white/20 text-white' : 'bg-[#F4EFE3] text-[#111311] border border-[#C4B9A3]'}`}>
                            Token #{v.token_number}
                          </span>
                        )}
                      </div>
                      <span className={`px-2.5 py-0.5 rounded-full text-[9.5px] font-black uppercase font-mono border ${
                        v.plant_decision_summary === 'ACCEPTED'
                          ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                          : 'bg-amber-100 text-amber-800 border-amber-300'
                      }`}>
                        {v.plant_decision_summary}
                      </span>
                    </div>

                    <div className={`flex items-center justify-between text-[11px] font-bold ${isSelected ? 'text-slate-200' : 'text-[#334155]'}`}>
                      <span>Visit #{v.visit_number}</span>
                      <span>{v.accepted_portion_count} / {v.portion_count} Portions Accepted</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT COLUMN (7/12): GROSS WEIGHT FORM & PORTION BREAKDOWN */}
        <div className="lg:col-span-7">
          {!selectedVisit ? (
            <div className="p-12 text-center border border-dashed border-[#C4B9A3] rounded-2xl bg-[#EFE9D9] text-xs font-bold text-slate-500">
              Select an eligible vehicle from the left queue to record Scale 1 gross weight.
            </div>
          ) : (
            <div className="p-6 rounded-2xl bg-[#EFE9D9] border border-[#C4B9A3] shadow-md space-y-5 text-[#111311]">
              <div className="flex items-center justify-between pb-3 border-b border-[#C4B9A3]">
                <div className="flex items-center space-x-3">
                  <div className="p-2.5 bg-indigo-700 text-white rounded-xl shadow-sm">
                    <Scale className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-extrabold text-[#111311]">Record Scale 1 Gross Weight</h3>
                    <p className="text-xs text-[#334155] font-semibold">
                      Vehicle: <strong className="font-mono text-[#111311]">{selectedVisit.vehicle_number}</strong> | Token: #{selectedVisit.token_number || 'N/A'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Portion Breakdown Table */}
              <div className="space-y-2">
                <span className="text-xs font-black uppercase text-[#111311]">
                  Portion Breakdown ({selectedVisit.accepted_portion_count} Accepted / {selectedVisit.portion_count} Total)
                </span>
                <div className="space-y-1.5">
                  {selectedVisit.portions.map((p) => (
                    <div
                      key={`portion-${String(p.id)}`}
                      className={`p-2.5 rounded-xl border flex items-center justify-between text-xs font-mono font-bold ${
                        p.plant_decision === 'ACCEPTED'
                          ? 'bg-[#F4EFE3] text-[#111311] border-[#C4B9A3]'
                          : 'bg-rose-50 text-rose-900 border-rose-200'
                      }`}
                    >
                      <div>
                        <span>Portion #{p.portion_number} - {p.declared_quantity_kg} KG</span>
                        {p.plant_rejection_reason && (
                          <span className="block text-[10px] text-rose-700 font-sans mt-0.5">
                            Reason: {p.plant_rejection_reason}
                          </span>
                        )}
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded text-[9.5px] font-black uppercase font-mono border ${
                          p.plant_decision === 'ACCEPTED'
                            ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                            : 'bg-rose-100 text-rose-800 border-rose-300'
                        }`}
                      >
                        {p.plant_decision}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <form onSubmit={handleSubmitGrossWeight} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold mb-1">
                      Weighbridge Ticket # <span className="text-rose-600">*</span>
                    </label>
                    <input
                      type="text"
                      value={ticketNumber}
                      onChange={(e) => setTicketNumber(e.target.value.toUpperCase())}
                      placeholder="e.g. WT-9025"
                      className="w-full px-3.5 py-2.5 text-xs font-mono font-bold rounded-xl border border-[#C4B9A3] bg-[#F4EFE3] text-[#111311]"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold mb-1">
                      Gross Loaded Weight (KG) <span className="text-rose-600">*</span>
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={grossWeight}
                      onChange={(e) => setGrossWeight(e.target.value ? Number(e.target.value) : '')}
                      placeholder="e.g. 32500"
                      className="w-full px-3.5 py-2.5 text-sm font-mono font-black rounded-xl border border-[#C4B9A3] bg-[#F4EFE3] text-[#111311]"
                      required
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full flex items-center justify-center space-x-2 py-3.5 px-4 rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white font-extrabold text-xs shadow-md border border-indigo-950 transition active:scale-95 disabled:opacity-50 mt-2"
                >
                  <CheckCircle2 className="w-5 h-5 text-white" />
                  <span className="text-sm">{isSubmitting ? 'Recording Weight...' : 'Save Scale 1 Gross Weight & Update Status to SCALE_1'}</span>
                </button>
              </form>
            </div>
          )}
        </div>
      </div>

      {/* BOTTOM SECTION: ACTIVE OPEN SCALE TICKETS */}
      <div className="p-6 rounded-2xl bg-[#EFE9D9] border border-[#C4B9A3] shadow-md space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-[#C4B9A3]">
          <div className="flex items-center space-x-2">
            <FileText className="w-4 h-4 text-indigo-700" />
            <h3 className="text-sm font-extrabold uppercase tracking-wider text-[#111311]">
              Active Open Scale Records ({openTickets.length} Gross Recorded / Tare Pending)
            </h3>
          </div>
          <span className="text-[11px] font-semibold text-slate-500 font-mono">
            Sorted by Gross Timestamp ↓
          </span>
        </div>

        {openTickets.length === 0 ? (
          <div className="p-8 text-center border border-dashed border-[#C4B9A3] rounded-xl bg-[#F4EFE3] text-xs font-bold text-slate-500">
            No open scale tickets currently waiting for tare weighing.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-medium">
              <thead className="bg-[#F4EFE3] text-slate-700 font-extrabold uppercase text-[10px] tracking-wider border-b border-[#C4B9A3]">
                <tr>
                  <th className="py-3 px-4">Ticket #</th>
                  <th className="py-3 px-4">Token #</th>
                  <th className="py-3 px-4">Vehicle #</th>
                  <th className="py-3 px-4">Gross Weight (KG)</th>
                  <th className="py-3 px-4">Gross Timestamp</th>
                  <th className="py-3 px-4 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#C4B9A3] text-[#111311]">
                {openTickets.map((t) => (
                  <tr key={`ticket-${String(t.id)}`} className="hover:bg-[#F4EFE3]/80 transition">
                    <td className="py-3 px-4 font-mono font-black text-indigo-900">
                      {t.ticket_number}
                    </td>
                    <td className="py-3 px-4 font-mono font-bold">
                      {t.token_number || '-'}
                    </td>
                    <td className="py-3 px-4 font-bold text-[#111311]">
                      {t.vehicle_number}
                    </td>
                    <td className="py-3 px-4 font-mono font-black text-[#1E3A8A]">
                      {t.gross_weight_kg} KG
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-600">
                      {t.gross_timestamp ? new Date(t.gross_timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '-'}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase font-mono bg-indigo-100 text-indigo-900 border border-indigo-200">
                        {t.current_status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
