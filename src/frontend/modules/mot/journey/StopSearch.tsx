'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { StopDetail } from './types';

interface Props {
  stops: StopDetail[];
  onSelectPending: (stop: StopDetail) => void;
}

/** Type-to-find shop selector; picking a pending shop opens its collection. */
export function StopSearch({ stops, onSelectPending }: Props) {
  const [shopSearchQuery, setShopSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchDropdownRef = useRef<HTMLDivElement | null>(null);

  // Close search dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchDropdownRef.current && !searchDropdownRef.current.contains(e.target as Node)) {
        setIsSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const matchingSearchStops = shopSearchQuery.trim()
    ? stops.filter((s) => {
        const q = shopSearchQuery.toLowerCase().trim();
        const sName = (s.shop_name || s.shop?.shop_name || '').toLowerCase();
        const sCode = (s.shop_code || s.shop?.shop_code || '').toLowerCase();
        const oName = (s.owner_name || s.shop?.owner_name || '').toLowerCase();
        const aName = (s.area_name || s.area_code || '').toLowerCase();
        return sName.includes(q) || sCode.includes(q) || oName.includes(q) || aName.includes(q);
      })
    : stops;

  return (
                      <div ref={searchDropdownRef} className="relative">
                        <div className="relative">
                          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                            <Search className="w-4 h-4" />
                          </div>
                          <input
                            type="text"
                            value={shopSearchQuery}
                            onChange={(e) => {
                              setShopSearchQuery(e.target.value);
                              setIsSearchOpen(true);
                            }}
                            onFocus={() => setIsSearchOpen(true)}
                            placeholder="Type to search or select shop…"
                            className="w-full text-xs font-semibold pl-9 pr-8 py-2.5 bg-subtle border border-border rounded-xl text-foreground focus:ring-2 focus:ring-primary focus:bg-white outline-hidden"
                          />
                          {shopSearchQuery && (
                            <button
                              type="button"
                              onClick={() => {
                                setShopSearchQuery('');
                                setIsSearchOpen(false);
                              }}
                              className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>

                        {isSearchOpen && (
                          <div className="absolute z-30 left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-card border border-border rounded-xl shadow-lg divide-y divide-border">
                            {matchingSearchStops.length === 0 ? (
                              <div className="p-3 text-center text-xs text-slate-400">
                                No matching shops found
                              </div>
                            ) : (
                              matchingSearchStops.map((stop) => {
                                const sName = stop.shop_name || stop.shop?.shop_name || 'Shop';
                                const sCode = stop.shop_code || stop.shop?.shop_code || '—';
                                const isVisited = stop.status === 'VISITED';
                                const isSkipped = stop.status === 'SKIPPED';
                                const isRejected = stop.status === 'REJECTED';
                                return (
                                  <button
                                    key={stop.id}
                                    type="button"
                                    onClick={() => {
                                      setIsSearchOpen(false);
                                      setShopSearchQuery('');
                                      if (!isVisited && !isSkipped && !isRejected) onSelectPending(stop);
                                    }}
                                    className="w-full p-2.5 text-left flex items-center justify-between hover:bg-subtle transition"
                                  >
                                    <div className="flex items-center space-x-2">
                                      <span className="w-6 h-6 rounded-md bg-muted text-slate-700 text-xs font-semibold flex items-center justify-center shrink-0">
                                        {stop.planned_sequence}
                                      </span>
                                      <div>
                                        <div className="text-xs font-semibold text-foreground">
                                          {sName} <span className="text-[10px] text-slate-500 font-normal">({sCode})</span>
                                        </div>
                                        <div className="text-[10px] text-slate-500">
                                          {stop.area_name || stop.area_code || 'No area'}
                                        </div>
                                      </div>
                                    </div>
                                    <div className="flex items-center space-x-1.5">
                                      {isVisited ? (
                                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800">
                                          Completed
                                        </span>
                                      ) : isSkipped ? (
                                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-100 text-rose-800">
                                          Skipped
                                        </span>
                                      ) : isRejected ? (
                                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-100 text-rose-800">
                                          Rejected
                                        </span>
                                      ) : (
                                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-primary text-white">
                                          Select
                                        </span>
                                      )}
                                    </div>
                                  </button>
                                );
                              })
                            )}
                          </div>
                        )}
                      </div>
  );
}
