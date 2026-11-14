'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search,
  Scale,
  FlaskConical,
  Truck,
  Building2,
  ShieldCheck,
  ShieldAlert,
  Send,
  FileSpreadsheet,
  Tv,
  ArrowRight,
  ClipboardList,
  LayoutDashboard,
  Command,
  X,
} from 'lucide-react';
import type { User } from '@core/types';
import { cn } from '@/lib/utils';

export interface CommandItem {
  id: string;
  title: string;
  category: 'Stations' | 'Actions' | 'Reports' | 'System';
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  keywords?: string[];
}

const ALL_COMMAND_ITEMS: CommandItem[] = [
  // Stations
  {
    id: 'sec-gate',
    title: 'Security Gate · Entry & Exit',
    category: 'Stations',
    href: '/department/security',
    icon: ShieldCheck,
    badge: 'Station',
    keywords: ['gate', 'entry', 'exit', 'token', 'security'],
  },
  {
    id: 'qa-testing',
    title: 'QA Laboratory · Testing & Sampling',
    category: 'Stations',
    href: '/department/qa',
    icon: FlaskConical,
    badge: 'Station',
    keywords: ['qa', 'lab', 'quality', 'test', 'sample', 'snf', 'fat', 'lr'],
  },
  {
    id: 'wb-station',
    title: 'Weighbridge Station · Gross & Tare Scales',
    category: 'Stations',
    href: '/department/weighbridge',
    icon: Scale,
    badge: 'Station',
    keywords: ['weighbridge', 'scale', 'gross', 'tare', 'weight', 'ticket'],
  },
  {
    id: 'silo-offloading',
    title: 'Silo Offloading · Production Reception',
    category: 'Stations',
    href: '/department/production',
    icon: Building2,
    badge: 'Station',
    keywords: ['silo', 'offloading', 'unloading', 'pump', 'production', 'tank'],
  },
  {
    id: 'zmcc-lab',
    title: 'ZMCC Laboratory · Intake Screening',
    category: 'Stations',
    href: '/zmcc/lab',
    icon: FlaskConical,
    badge: 'ZMCC',
    keywords: ['zmcc', 'lab', 'intake', 'screening', 'reception'],
  },
  {
    id: 'zmcc-reception',
    title: 'ZMCC Reception · Tanks & Weighing',
    category: 'Stations',
    href: '/phe',
    icon: ClipboardList,
    badge: 'ZMCC',
    keywords: ['phe', 'reception', 'tanks', 'weighing', 'intake'],
  },
  {
    id: 'mot-journeys',
    title: 'Mobile Tester active journeys',
    category: 'Stations',
    href: '/mot',
    icon: Truck,
    badge: 'Mobile',
    keywords: ['mot', 'journey', 'collection', 'tester', 'gps'],
  },
  {
    id: 'approvals-inbox',
    title: 'Central Approval Inbox · Exceptions & Overrides',
    category: 'Stations',
    href: '/approvals',
    icon: ShieldAlert,
    badge: 'Governance',
    keywords: ['approvals', 'exceptions', 'overrides', 'inbox', 'review'],
  },
  {
    id: 'my-submitted-requests',
    title: 'My submitted requests',
    category: 'Stations',
    href: '/my-requests',
    icon: Send,
    badge: 'Personal',
    keywords: ['requests', 'sent', 'status', 'tracking', 'my requests'],
  },
  {
    id: 'zmcc-manager-hub',
    title: 'ZMCC Manager',
    category: 'Stations',
    href: '/mpd/zmcc-manager',
    icon: LayoutDashboard,
    badge: 'Management',
    keywords: ['manager', 'command', 'transit', 'hierarchy'],
  },
  {
    id: 'yard-board',
    title: 'Yard TV Board · Live Tanker Flow',
    category: 'Stations',
    href: '/tv-board',
    icon: Tv,
    badge: 'Display',
    keywords: ['tv', 'board', 'yard', 'live', 'radar'],
  },

  // Actions
  {
    id: 'action-gate-entry',
    title: 'Record Gate Entry & Token Issue',
    category: 'Actions',
    href: '/department/security?tab=WAITING_ENTRY',
    icon: ShieldCheck,
    badge: 'Quick Action',
    keywords: ['new entry', 'token', 'arrive'],
  },
  {
    id: 'action-gross-scale',
    title: 'Perform Initial Gross Scale Weighment',
    category: 'Actions',
    href: '/department/weighbridge?tab=SCALE_ACTION',
    icon: Scale,
    badge: 'Quick Action',
    keywords: ['gross', 'first weight', 'loaded'],
  },
  {
    id: 'action-tare-scale',
    title: 'Perform Intermediate / Final Empty Tare',
    category: 'Actions',
    href: '/department/weighbridge?tab=SCALE_ACTION',
    icon: Scale,
    badge: 'Quick Action',
    keywords: ['tare', 'second weight', 'empty'],
  },
  {
    id: 'action-silo-start',
    title: 'Allocate Bay & Start Silo Pumping',
    category: 'Actions',
    href: '/department/production?tab=READY',
    icon: Building2,
    badge: 'Quick Action',
    keywords: ['pump start', 'bay', 'silo transfer'],
  },

  // Reports
  {
    id: 'rep-daily-ops',
    title: 'Daily Quality & Operations Report',
    category: 'Reports',
    href: '/super-admin/reports?tab=daily',
    icon: FileSpreadsheet,
    badge: 'Report',
    keywords: ['daily', 'quality', 'operations', 'audit'],
  },
  {
    id: 'rep-transit',
    title: 'Transit Loss Reconciliation',
    category: 'Reports',
    href: '/mpd/zmcc-manager?tab=PLANT_TRANSIT&view=RECONCILIATION',
    icon: FileSpreadsheet,
    badge: 'Report',
    keywords: ['loss', 'transit', 'reconciliation', 'shrinkage'],
  },
];

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser?: User | null;
}

export function CommandPalette({ isOpen, onClose, currentUser }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Focus input on open
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Filter command items
  const filteredItems = useMemo(() => {
    if (!query.trim()) return ALL_COMMAND_ITEMS;
    const q = query.toLowerCase().trim();
    return ALL_COMMAND_ITEMS.filter((item) => {
      if (item.title.toLowerCase().includes(q)) return true;
      if (item.category.toLowerCase().includes(q)) return true;
      if (item.badge?.toLowerCase().includes(q)) return true;
      if (item.keywords?.some((k) => k.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [query]);

  // Handle item selection
  const handleSelect = useCallback(
    (item: CommandItem) => {
      onClose();
      router.push(item.href);
    },
    [onClose, router]
  );

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (filteredItems.length === 0 ? 0 : (prev + 1) % filteredItems.length));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (filteredItems.length === 0 ? 0 : (prev - 1 + filteredItems.length) % filteredItems.length));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredItems[selectedIndex]) {
          handleSelect(filteredItems[selectedIndex]);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filteredItems, selectedIndex, handleSelect, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-3 sm:p-6 md:pt-20">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity animate-in fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Palette Modal (Nested rounded corners, unslop aesthetic) */}
      <div className="relative w-full max-w-xl bg-card rounded-2xl border border-border shadow-xl overflow-hidden flex flex-col z-10 animate-in zoom-in-95 duration-150">
        {/* Search Header */}
        <div className="flex items-center px-4 py-3 border-b border-border gap-2 bg-background/50">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Type a command, station name, or action…"
            className="w-full bg-transparent text-sm font-medium text-foreground placeholder:text-muted-foreground focus:outline-hidden"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground"
              aria-label="Clear query"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <kbd className="hidden sm:inline-flex items-center gap-0.5 text-xs bg-muted px-2 py-0.5 rounded border border-border text-muted-foreground font-mono">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div className="scrollbar-thin overscroll-contain max-h-[380px] overflow-y-auto p-2 space-y-1">
          {filteredItems.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground space-y-1">
              <Command className="w-6 h-6 mx-auto text-muted-foreground/60 mb-2" />
              <p className="font-semibold text-foreground">No matching commands found</p>
              <p>Try searching for "weighbridge", "silo", "gate", or "qa".</p>
            </div>
          ) : (
            filteredItems.map((item, idx) => {
              const Icon = item.icon;
              const isSelected = idx === selectedIndex;

              return (
                <div
                  key={item.id}
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={cn(
                    'flex items-center justify-between p-3 rounded-xl cursor-pointer text-xs font-semibold transition',
                    isSelected
                      ? 'bg-primary text-primary-foreground shadow-2xs'
                      : 'hover:bg-muted text-foreground'
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div
                      className={cn(
                        'w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border',
                        isSelected
                          ? 'bg-primary-foreground/15 border-primary-foreground/30 text-primary-foreground'
                          : 'bg-muted border-border text-foreground'
                      )}
                    >
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <span className="truncate">{item.title}</span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    {item.badge && (
                      <span
                        className={cn(
                          'text-xs px-2 py-0.5 rounded-md font-semibold',
                          isSelected
                            ? 'bg-primary-foreground/20 text-primary-foreground'
                            : 'bg-muted border border-border text-muted-foreground'
                        )}
                      >
                        {item.badge}
                      </span>
                    )}
                    <ArrowRight className="w-3.5 h-3.5 opacity-60" />
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer shortcuts info */}
        <div className="hidden sm:flex px-4 py-2 bg-muted/30 border-t border-border items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            <span>↑↓ Navigate</span>
            <span>↵ Select</span>
          </div>
          <span>Esc to close</span>
        </div>
      </div>
    </div>
  );
}
