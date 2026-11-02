import React, { useState, useMemo } from 'react';
import { Search, History, ChevronLeft, ChevronRight, Scale, Database, Clock, User } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { TableWrapper } from '@/components/ui/table-wrapper';
import type { SubordinateWorkHistoryItem } from '@/backend/services/productionHeadOverviewService';

interface SubordinateWorkHistoryFeedProps {
  history: SubordinateWorkHistoryItem[];
}

const ITEMS_PER_PAGE = 10;

export const SubordinateWorkHistoryFeed: React.FC<SubordinateWorkHistoryFeedProps> = ({ history }) => {
  const [stationFilter, setStationFilter] = useState<'ALL' | 'WEIGHBRIDGE' | 'RECEPTION'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

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

  const totalPages = Math.max(1, Math.ceil(filteredHistory.length / ITEMS_PER_PAGE));
  const activePage = Math.min(currentPage, totalPages);
  const startIndex = (activePage - 1) * ITEMS_PER_PAGE;
  const paginatedItems = filteredHistory.slice(startIndex, startIndex + ITEMS_PER_PAGE);

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
          <Badge variant="outline" className="bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/20 text-xs font-semibold">
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

  return (
    <div className="space-y-4">
      {/* 1. Filter Buttons & Search Box */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 text-xs">
          <button
            type="button"
            onClick={() => {
              setStationFilter('ALL');
              setCurrentPage(1);
            }}
            className={`min-h-9 px-3 py-1.5 rounded-lg font-semibold transition-colors flex items-center gap-1.5 ${
              stationFilter === 'ALL'
                ? 'bg-primary text-primary-foreground shadow-2xs'
                : 'border border-border bg-card text-muted-foreground hover:text-foreground'
            }`}
          >
            <span>All Activities</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-primary-foreground/20">
              {history.length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              setStationFilter('WEIGHBRIDGE');
              setCurrentPage(1);
            }}
            className={`min-h-9 px-3 py-1.5 rounded-lg font-semibold transition-colors flex items-center gap-1.5 ${
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
            className={`min-h-9 px-3 py-1.5 rounded-lg font-semibold transition-colors flex items-center gap-1.5 ${
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
            placeholder="Search vehicle, token, operator…"
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
      <div className="rounded-xl border border-border bg-card shadow-2xs overflow-hidden">
        {paginatedItems.length > 0 ? (
          <div>
            <TableWrapper>
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-muted-foreground font-semibold">
                    <th className="py-3 px-3.5">Timestamp</th>
                    <th className="py-3 px-3.5">Station</th>
                    <th className="py-3 px-3.5">Operation</th>
                    <th className="py-3 px-3.5">Vehicle / Token</th>
                    <th className="py-3 px-3.5">Operator</th>
                    <th className="py-3 px-3.5 text-right">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {paginatedItems.map((item) => {
                    const timeStr = new Date(item.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                      hour12: true,
                    });

                    return (
                      <tr key={item.id} className="hover:bg-muted/20 transition-colors">
                        <td className="py-3 px-3.5 font-mono text-muted-foreground whitespace-nowrap">
                          {timeStr}
                        </td>
                        <td className="py-3 px-3.5 whitespace-nowrap">
                          <span className="font-semibold text-foreground">
                            {item.station === 'WEIGHBRIDGE' ? 'Weighbridge' : 'Silo Reception'}
                          </span>
                        </td>
                        <td className="py-3 px-3.5 whitespace-nowrap">
                          {getActionBadge(item.action, item.actionLabel)}
                        </td>
                        <td className="py-3 px-3.5 whitespace-nowrap">
                          <div className="font-mono font-bold uppercase tracking-wider text-foreground">
                            {item.vehicleNumber}
                          </div>
                          {item.tokenNumber && (
                            <span className="text-[11px] text-muted-foreground font-mono">
                              Token #{item.tokenNumber}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3.5 whitespace-nowrap">
                          <div className="font-medium text-foreground">{item.operatorName}</div>
                          <span className="text-[11px] text-muted-foreground">@{item.operatorUsername}</span>
                        </td>
                        <td className="py-3 px-3.5 text-right font-mono tabular-nums whitespace-nowrap">
                          {item.details.netWeightKg !== undefined && (
                            <div>
                              <strong className="text-foreground font-bold">
                                {item.details.netWeightKg.toLocaleString()} kg
                              </strong>{' '}
                              <span className="text-muted-foreground">net</span>
                            </div>
                          )}
                          {item.details.volumeAt13TsLiters !== undefined && (
                            <div className="text-[11px] text-primary font-semibold">
                              {item.details.volumeAt13TsLiters.toLocaleString()} L @13% TS
                            </div>
                          )}
                          {item.details.siloNumber && (
                            <div className="text-[11px] text-muted-foreground">
                              {item.details.siloNumber}
                            </div>
                          )}
                          {item.details.ticketNumber && (
                            <div className="text-[10px] text-muted-foreground">
                              Ticket #{item.details.ticketNumber}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrapper>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-card text-xs">
                <span className="text-muted-foreground">
                  Showing {startIndex + 1}–{Math.min(filteredHistory.length, startIndex + ITEMS_PER_PAGE)} of{' '}
                  {filteredHistory.length} events
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={activePage <= 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    className="flex h-8 items-center gap-1 px-2.5 rounded-lg border border-border bg-background hover:bg-muted text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed transition"
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
                    className="flex h-8 items-center gap-1 px-2.5 rounded-lg border border-border bg-background hover:bg-muted text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed transition"
                  >
                    <span>Next</span>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="py-12 px-4 text-center space-y-2">
            <History className="h-8 w-8 text-muted-foreground mx-auto opacity-50" />
            <h4 className="font-semibold text-sm text-foreground">No Subordinate Events Found</h4>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              {searchQuery
                ? 'No weighbridge tickets or silo offloading events matched your search query.'
                : 'No scale weighments or silo offloading operations have been recorded yet during this business day.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
