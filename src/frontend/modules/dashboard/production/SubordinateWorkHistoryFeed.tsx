import React, { useState, useMemo } from 'react';
import { Search, ChevronLeft, ChevronRight, Scale, Database, Clock, User } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import { useListPageSize } from '@/components/ui/pagination';
import type { SubordinateWorkHistoryItem } from '@/backend/services/productionHeadOverviewService';

interface SubordinateWorkHistoryFeedProps {
  history: SubordinateWorkHistoryItem[];
}

export const SubordinateWorkHistoryFeed: React.FC<SubordinateWorkHistoryFeedProps> = ({ history }) => {
  const [stationFilter, setStationFilter] = useState<'ALL' | 'WEIGHBRIDGE' | 'RECEPTION'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = useListPageSize(25);

  const filteredHistory = useMemo(() => {
    return history.filter((item) => {
      if (stationFilter !== 'ALL' && item.station !== stationFilter) {
        return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const vNum = item.vehicleNumber.toLowerCase();
        const tNum = (item.tokenNumber || '').toLowerCase();
        const opName = item.operatorName.toLowerCase();
        const opUser = item.operatorUsername.toLowerCase();
        const ticketNum = (item.details.ticketNumber || '').toLowerCase();
        const siloNum = (item.details.siloNumber || '').toLowerCase();

        return (
          vNum.includes(q) ||
          tNum.includes(q) ||
          opName.includes(q) ||
          opUser.includes(q) ||
          ticketNum.includes(q) ||
          siloNum.includes(q)
        );
      }

      return true;
    });
  }, [history, stationFilter, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredHistory.length / itemsPerPage));
  const activePage = Math.min(currentPage, totalPages);
  const startIndex = (activePage - 1) * itemsPerPage;
  const paginatedItems = filteredHistory.slice(startIndex, startIndex + itemsPerPage);

  const getActionBadge = (action: SubordinateWorkHistoryItem['action'], label: string) => {
    switch (action) {
      case 'GROSS_WEIGHMENT':
        return (
          <Badge variant="outline" className="bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20 text-xs font-semibold">
            {label}
          </Badge>
        );
      case 'TARE_WEIGHMENT':
        return (
          <Badge variant="outline" className="bg-muted text-secondary-foreground border-border text-xs font-semibold">
            {label}
          </Badge>
        );
      case 'PUMP_STARTED':
        return (
          <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20 text-xs font-semibold">
            {label}
          </Badge>
        );
      case 'UNLOAD_COMPLETED':
        return (
          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20 text-xs font-semibold">
            {label}
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="text-xs">
            {label}
          </Badge>
        );
    }
  };

  const columns: DataColumn<SubordinateWorkHistoryItem>[] = [
    {
      key: 'timestamp',
      header: 'Timestamp',
      label: 'Timestamp',
      cell: (item) => (
        <span className="font-mono text-muted-foreground">
          {new Date(item.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true,
          })}
        </span>
      ),
    },
    {
      key: 'station',
      header: 'Station',
      label: 'Station',
      cell: (item) => (
        <span className="font-semibold text-foreground">
          {item.station === 'WEIGHBRIDGE' ? 'Weighbridge' : 'Silo Reception'}
        </span>
      ),
    },
    {
      key: 'operation',
      header: 'Operation',
      label: 'Operation',
      cell: (item) => getActionBadge(item.action, item.actionLabel),
    },
    {
      key: 'vehicle',
      header: 'Vehicle / Token',
      label: 'Vehicle / Token',
      primary: true,
      cell: (item) => (
        <div>
          <div className="font-mono font-semibold uppercase text-foreground">{item.vehicleNumber}</div>
          {item.tokenNumber && (
            <span className="text-xs text-muted-foreground font-mono">Token #{item.tokenNumber}</span>
          )}
        </div>
      ),
    },
    {
      key: 'operator',
      header: 'Operator',
      label: 'Operator',
      cell: (item) => (
        <div>
          <div className="font-medium text-foreground">{item.operatorName}</div>
          <span className="text-xs text-muted-foreground">@{item.operatorUsername}</span>
        </div>
      ),
    },
    {
      key: 'details',
      header: 'Details',
      label: 'Details',
      align: 'right',
      cell: (item) => (
        <div className="font-mono tabular-nums">
          {item.details.netWeightKg !== undefined && (
            <div>
              <strong className="text-foreground font-semibold">{item.details.netWeightKg.toLocaleString()} kg</strong>{' '}
              <span className="text-muted-foreground">net</span>
            </div>
          )}
          {item.details.volumeAt13TsLiters !== undefined && (
            <div className="text-xs text-primary font-semibold">
              {item.details.volumeAt13TsLiters.toLocaleString()} L @13 TS
            </div>
          )}
          {item.details.siloNumber && <div className="text-xs text-muted-foreground">{item.details.siloNumber}</div>}
          {item.details.ticketNumber && (
            <div className="text-xs text-muted-foreground">Ticket #{item.details.ticketNumber}</div>
          )}
        </div>
      ),
    },
  ];
  return (
    <div className="space-y-4">
      {/* 1. Filter Buttons & Search Box */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 overflow-x-auto pb-0.5 text-xs">
          <button
            type="button"
            onClick={() => {
              setStationFilter('ALL');
              setCurrentPage(1);
            }}
            className={`min-h-9 px-3 py-2 rounded-lg font-semibold transition-colors flex items-center gap-2 ${
              stationFilter === 'ALL'
                ? 'bg-primary text-primary-foreground shadow-2xs'
                : 'border border-border bg-card text-muted-foreground hover:text-foreground'
            }`}
          >
            <span>All Activities</span>
            <span className="text-xs px-2 py-0.5 rounded-md bg-primary-foreground/20">
              {history.length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              setStationFilter('WEIGHBRIDGE');
              setCurrentPage(1);
            }}
            className={`min-h-9 px-3 py-2 rounded-lg font-semibold transition-colors flex items-center gap-2 ${
              stationFilter === 'WEIGHBRIDGE'
                ? 'bg-primary text-primary-foreground shadow-2xs'
                : 'border border-border bg-card text-muted-foreground hover:text-foreground'
            }`}
          >
            <Scale className="h-3.5 w-3.5" />
            <span>Weighbridge</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setStationFilter('RECEPTION');
              setCurrentPage(1);
            }}
            className={`min-h-9 px-3 py-2 rounded-lg font-semibold transition-colors flex items-center gap-2 ${
              stationFilter === 'RECEPTION'
                ? 'bg-primary text-primary-foreground shadow-2xs'
                : 'border border-border bg-card text-muted-foreground hover:text-foreground'
            }`}
          >
            <Database className="h-3.5 w-3.5" />
            <span>Silo Offloading</span>
          </button>
        </div>

        <div className="relative sm:w-72">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search vehicle or token…"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            className="pl-9 text-xs h-9 bg-card rounded-lg"
          />
        </div>
      </div>

      {/* 2. Work History Table */}
      <DataTable
        columns={columns}
        rows={paginatedItems}
        getRowId={(item) => String(item.id)}
        emptyTitle="No events yet"
        emptyDescription={
          searchQuery
            ? 'No weighbridge tickets or silo offloading events matched your search query.'
            : 'No scale weighments or silo offloading operations have been recorded yet during this business day.'
        }
        footer={
          totalPages > 1 && paginatedItems.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-card px-4 py-3 text-xs">
              <span className="text-muted-foreground">
                Showing {startIndex + 1}–{Math.min(filteredHistory.length, startIndex + itemsPerPage)} of{' '}
                {filteredHistory.length} events
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={activePage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="flex min-h-11 items-center gap-1 px-3 rounded-lg border border-border bg-background hover:bg-muted text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  <span>Previous</span>
                </button>
                <span className="px-2 font-medium text-foreground">
                  Page {activePage} of {totalPages}
                </span>
                <button
                  type="button"
                  disabled={activePage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className="flex min-h-11 items-center gap-1 px-3 rounded-lg border border-border bg-background hover:bg-muted text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  <span>Next</span>
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ) : null
        }
      />
    </div>
  );
};
