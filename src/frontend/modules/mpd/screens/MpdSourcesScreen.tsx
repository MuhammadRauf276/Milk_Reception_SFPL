'use client';

import React, { useState } from 'react';
import { Building2, Building, CheckCircle2, Search } from 'lucide-react';
import type { ZmccCenterTelemetry, PlantContractorTelemetry } from '../types';
import type { MpdExecutiveTelemetry } from '@/backend/services/mpdExecutiveService';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import { formatMetric, NO_DATA } from '../format';
import { Pager, paginate, pageCount } from '@/frontend/modules/dashboard/components/Pager';

interface MpdSourcesScreenProps {
  zmccs: ZmccCenterTelemetry[];
  contractors: PlantContractorTelemetry[];
  intakeBySource?: MpdExecutiveTelemetry['intakeBySource'];
}

type IntakeRow = MpdExecutiveTelemetry['intakeBySource'][number];

const intakeColumns: DataColumn<IntakeRow>[] = [
  {
    key: 'source',
    header: 'Source',
    label: 'Source',
    primary: true,
    cell: (r) => (
      <div>
        <div className="font-semibold text-foreground">{r.sourceName}</div>
        {r.erpCode ? <div className="text-muted-foreground tabular-nums">{r.erpCode}</div> : null}
      </div>
    ),
  },
  { key: 'netKg', header: 'Net kg', label: 'Net kg', align: 'right', cell: (r) => <span className="tabular-nums">{r.netKg.toLocaleString()}</span> },
  {
    key: 'ts13',
    header: '@13 TS L',
    label: '@13 TS L',
    align: 'right',
    cell: (r) => (
      <div>
        <span className="tabular-nums font-semibold">{r.at13tsLiters.toLocaleString()}</span>
        {r.missing13tsCount > 0 ? <div className="text-xs text-amber-700">{r.missing13tsCount} without tests</div> : null}
      </div>
    ),
  },
  { key: 'grossL', header: 'Gross L', label: 'Gross L', align: 'right', cell: (r) => <span className="tabular-nums text-muted-foreground">{r.grossLiters.toLocaleString()}</span> },
  {
    key: 'quality',
    header: 'Quality',
    label: 'Quality',
    align: 'center',
    cell: (r) => (
      <span className="tabular-nums">
        {formatMetric(r.avgLr)} | {formatMetric(r.avgFatPercent, '%')} | {formatMetric(r.avgSnfPercent, '%')} | {formatMetric(r.avgTsPercent, '%')}
      </span>
    ),
  },
];

const contractorColumns: DataColumn<PlantContractorTelemetry>[] = [
  {
    key: 'contractor',
    header: 'Contractor Name / Code',
    label: 'Contractor name / code',
    primary: true,
    cell: (c) => (
      <div>
        <div className="font-semibold text-foreground">{c.name}</div>
        <div className="text-muted-foreground tabular-nums text-xs">{c.code}</div>
      </div>
    ),
  },
  {
    key: 'delivered',
    header: 'Delivered to Plant',
    label: 'Delivered to plant',
    align: 'right',
    cell: (c) => <span className="tabular-nums font-semibold text-foreground">{c.deliveredLiters.toLocaleString()} L</span>,
  },
  {
    key: 'qa',
    header: 'Plant QA',
    label: 'Plant QA',
    align: 'center',
    cell: (c) => (
      <span className="tabular-nums">
        <span className="font-semibold text-foreground">{formatMetric(c.avgFatPercent, '%')}</span>
        <span className="text-muted-foreground mx-1">|</span>
        <span className="font-semibold text-foreground">{formatMetric(c.avgLr)}</span>
      </span>
    ),
  },
  {
    key: 'passRate',
    header: 'QA Pass Rate',
    label: 'QA pass rate',
    align: 'center',
    cell: (c) =>
      c.qualityPassRatePercent === null ? (
        <span className="text-muted-foreground">{NO_DATA}</span>
      ) : (
        <span className="inline-flex items-center gap-1 tabular-nums font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
          {c.qualityPassRatePercent}%
        </span>
      ),
  },
];

export const MpdSourcesScreen: React.FC<MpdSourcesScreenProps> = ({
  zmccs = [],
  contractors = [],
  intakeBySource = [],
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [IntakePage, setIntakePage] = useState(1);
  const [ContractorPage, setContractorPage] = useState(1);
  const [sourceFilter, setSourceFilter] = useState<'ALL' | 'ZMCC' | 'CONTRACTORS'>('ALL');

  const filteredZmccs = (zmccs ?? []).filter(
    (z) => z.name.toLowerCase().includes(searchTerm.toLowerCase()) || z.code.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredContractors = (contractors ?? []).filter(
    (c) => c.name.toLowerCase().includes(searchTerm.toLowerCase()) || c.code.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="bg-card border-border flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-4 rounded-2xl border">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-border focus:outline-hidden focus:border-primary bg-subtle min-h-11"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSourceFilter('ALL')}
            className={`px-3 py-2 min-h-11 rounded-lg text-xs font-semibold transition-colors ${
              sourceFilter === 'ALL' ? 'bg-primary text-white' : 'bg-muted text-secondary-foreground hover:bg-muted/80'
            }`}
          >
            All ({(zmccs ?? []).length + (contractors ?? []).length})
          </button>
          <button
            onClick={() => setSourceFilter('ZMCC')}
            className={`px-3 py-2 min-h-11 rounded-lg text-xs font-semibold transition-colors ${
              sourceFilter === 'ZMCC' ? 'bg-primary text-white' : 'bg-muted text-secondary-foreground hover:bg-muted/80'
            }`}
          >
            ZMCC ({(zmccs ?? []).length})
          </button>
          <button
            onClick={() => setSourceFilter('CONTRACTORS')}
            className={`px-3 py-2 min-h-11 rounded-lg text-xs font-semibold transition-colors ${
              sourceFilter === 'CONTRACTORS' ? 'bg-primary text-white' : 'bg-muted text-secondary-foreground hover:bg-muted/80'
            }`}
          >
            Contractors ({(contractors ?? []).length})
          </button>
        </div>
      </div>

      {(sourceFilter === 'ALL' || sourceFilter === 'ZMCC') && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-xs font-semibold text-foreground">
                ZMCC centers
              </h2>
            </div>
            <span className="text-xs tabular-nums font-medium text-muted-foreground">
              {filteredZmccs.length} centers active
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredZmccs.map((z) => (
              <div
                key={z.id}
                className="bg-card border border-border rounded-2xl p-4 shadow-xs hover:border-primary/50 transition-[color,background-color,border-color,box-shadow,opacity,transform] flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="tabular-nums text-xs px-2 py-0.5 rounded bg-muted text-secondary-foreground font-semibold">
                      {z.code}
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                      <CheckCircle2 className="w-3 h-3" /> Active
                    </span>
                  </div>
                  <h3 className="text-sm font-semibold text-foreground">{z.name}</h3>

                  <div className="bg-card border-border mt-3 grid grid-cols-2 gap-2 p-3 rounded-lg border">
                    <div>
                      <div className="text-xs text-muted-foreground font-medium">Received today</div>
                      <div className="tabular-nums font-semibold text-foreground text-sm">
                        {z.intakeAt13tsLiters.toLocaleString()} L<span className="ml-1 text-xs font-semibold text-muted-foreground">@13 TS</span>
                      </div>
                      <div className="tabular-nums text-xs text-muted-foreground">Gross {z.intakeLiters.toLocaleString()} L</div>
                      {z.intakeMissing13tsCount > 0 ? <div className="text-xs text-amber-700">{z.intakeMissing13tsCount} without tests</div> : null}
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground font-medium">Dispatch Fat / LR</div>
                      <div className="tabular-nums font-semibold text-foreground text-xs">
                        {formatMetric(z.avgFatPercent, '%')} | {formatMetric(z.avgLr)}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-secondary-foreground font-medium">Tank stock (@13 TS)</span>
                      <span className="tabular-nums font-semibold text-foreground">
                        {z.siloStockAt13tsLiters != null
                          ? `${z.siloStockAt13tsLiters.toLocaleString()} L @13 TS`
                          : '—'}
                        {' '}
                        <span className="font-normal text-muted-foreground">
                          (physical fill {formatMetric(z.siloCapacityPercent, '%')})
                        </span>
                      </span>
                    </div>
                    <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full ${
                          (z.siloCapacityPercent ?? 0) > 85
                            ? 'bg-amber-500'
                            : (z.siloCapacityPercent ?? 0) > 40
                            ? 'bg-primary'
                            : 'bg-border-strong'
                        }`}
                        style={{ width: `${Math.min(z.siloCapacityPercent ?? 0, 100)}%` }}
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-xs text-secondary-foreground">
                  <span>Dispatched Today:</span>
                  <span className="text-right tabular-nums font-semibold text-primary">
                    {z.dispatchedAt13tsLiters.toLocaleString()} L @13 TS ({z.dispatchedTankerCount} tankers)
                    <span className="block text-xs font-normal text-muted-foreground">
                      Gross {z.dispatchedLiters.toLocaleString()} L
                      {z.dispatchedMissing13tsCount > 0 ? ` · ${z.dispatchedMissing13tsCount} without tests` : ''}
                    </span>
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-secondary-foreground">
                  <span>Not unloaded</span>
                  <span className={`tabular-nums font-semibold ${z.leftWithoutFullUnloadingCount > 0 ? 'text-amber-700' : 'text-secondary-foreground'}`}>
                    {z.leftWithoutFullUnloadingCount}
                                                          </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {(sourceFilter === 'ALL' || sourceFilter === 'ZMCC') && intakeBySource.length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden shadow-xs">
          <div className="p-4 border-b border-border text-xs font-semibold text-foreground">Received today by milk source</div>
          <div className="p-3">
            <DataTable
              columns={intakeColumns}
              rows={paginate(intakeBySource, Math.min(IntakePage, pageCount(intakeBySource.length)))}
              getRowId={(r) => r.sourceId ?? r.sourceName}
              footer={<Pager page={Math.min(IntakePage, pageCount(intakeBySource.length))} totalPages={pageCount(intakeBySource.length)} total={intakeBySource.length} onPageChange={setIntakePage} />}
            />
          </div>
        </div>
      )}

      {(sourceFilter === 'ALL' || sourceFilter === 'CONTRACTORS') && (
        <div className="bg-card border border-border rounded-xl overflow-hidden shadow-xs">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Building className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-xs font-semibold text-foreground">
                Direct Plant Commercial Contractors
              </h2>
            </div>
            <span className="text-xs tabular-nums font-medium text-muted-foreground">
              {filteredContractors.length} active contractors
            </span>
          </div>

          <div className="p-3">
            <DataTable
              columns={contractorColumns}
              rows={paginate(filteredContractors, Math.min(ContractorPage, pageCount(filteredContractors.length)))}
              getRowId={(c) => c.id}
              emptyTitle="No direct contractors found."
              footer={<Pager page={Math.min(ContractorPage, pageCount(filteredContractors.length))} totalPages={pageCount(filteredContractors.length)} total={filteredContractors.length} onPageChange={setContractorPage} />}
            />
          </div>
        </div>
      )}
    </div>
  );
};
