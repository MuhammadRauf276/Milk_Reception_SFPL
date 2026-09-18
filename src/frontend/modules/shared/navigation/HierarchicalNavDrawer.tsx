'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { User } from '@core/types';
import { Milk, X, ChevronDown, ChevronRight } from 'lucide-react';
import { getRoleNavSections, RoleNavSection, RoleNavLeaf } from './roleNavConfig';

interface HierarchicalNavDrawerProps {
  currentUser: User | null;
  isOpen: boolean;
  onClose: () => void;
  triggerButtonRef?: React.RefObject<HTMLButtonElement | null>;
  onNavigate?: (href: string) => void;
}

export const HierarchicalNavDrawer: React.FC<HierarchicalNavDrawerProps> = ({
  currentUser,
  isOpen,
  onClose,
  triggerButtonRef,
  onNavigate,
}) => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const drawerRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  const sections = useMemo(() => getRoleNavSections(currentUser), [currentUser]);

  // Determine if a leaf is currently active based on current path and search params
  const isLeafActive = useCallback(
    (leafHref: string) => {
      const [leafPath, leafQueryStr] = leafHref.split('?');
      if (pathname !== leafPath) return false;

      const leafParams = new URLSearchParams(leafQueryStr || '');

      // Check each leaf query parameter against current search params
      let allMatch = true;
      leafParams.forEach((val, key) => {
        const curVal = searchParams?.get(key);
        if (!curVal) {
          // Check default fallback if query parameter omitted in URL
          if (leafPath === '/phe' && key === 'section' && val === 'arrivals') {
            // default section
          } else if (leafPath === '/phe' && key === 'view' && val === 'mot-arrival') {
            // default view
          } else if (leafPath === '/zmcc/lab' && key === 'tab' && val === 'queue') {
            // default tab
          } else if (leafPath === '/zmcc/dispatch' && key === 'tab' && val === 'new') {
            // default tab
          } else if (leafPath === '/department/security' && key === 'tab' && val === 'WAITING_ENTRY') {
            // default tab
          } else if (leafPath === '/department/qa' && key === 'tab' && val === 'WAITING') {
            // default tab
          } else if (leafPath === '/department/weighbridge' && key === 'tab' && val === 'FIRST_WEIGHT') {
            // default tab
          } else if (leafPath === '/department/production' && key === 'tab' && val === 'READY') {
            // default tab
          } else if (leafPath === '/contractor/manager' && key === 'tab' && val === 'OVERVIEW') {
            // default tab
          } else if (leafPath === '/mpd/zmcc-manager' && key === 'tab' && val === 'OVERVIEW') {
            // default tab
          } else {
            allMatch = false;
          }
        } else if (curVal.toLowerCase() !== val.toLowerCase()) {
          allMatch = false;
        }
      });

      return allMatch;
    },
    [pathname, searchParams]
  );

  // Direct section match (for sections without children)
  const isSectionActive = useCallback(
    (section: RoleNavSection) => {
      if (!section.href) return false;
      return isLeafActive(section.href);
    },
    [isLeafActive]
  );

  // Auto-expand section containing active leaf whenever drawer opens or route changes
  useEffect(() => {
    if (!isOpen) return;
    sections.forEach((section) => {
      if (section.children) {
        const hasActiveLeaf = section.children.some((leaf) => isLeafActive(leaf.href));
        if (hasActiveLeaf) {
          setExpandedSections((prev) => ({ ...prev, [section.id]: true }));
        }
      }
    });
  }, [isOpen, sections, isLeafActive]);

  // Accessibility: Focus trap & Escape key handling
  useEffect(() => {
    if (!isOpen) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Move focus into the drawer when opened
    const focusTimer = setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 40);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        setTimeout(() => triggerButtonRef?.current?.focus(), 0);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      clearTimeout(focusTimer);
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose, triggerButtonRef]);

  // Tab key trap inside drawer
  const handleDrawerKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Tab') return;
    if (!drawerRef.current) return;

    const focusableElements = drawerRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === firstElement) {
        e.preventDefault();
        lastElement.focus();
      }
    } else {
      if (document.activeElement === lastElement) {
        e.preventDefault();
        firstElement.focus();
      }
    }
  };

  const handleToggleSection = (sectionId: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }));
  };

  const handleLeafClick = (href: string) => {
    if (onNavigate) {
      onNavigate(href);
    } else {
      router.push(href);
    }
    onClose();
    setTimeout(() => triggerButtonRef?.current?.focus(), 0);
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex"
      role="dialog"
      aria-modal="true"
      aria-label="Navigation Drawer"
      onKeyDown={handleDrawerKeyDown}
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer Panel */}
      <aside
        ref={drawerRef}
        className="relative z-50 w-80 max-w-[85vw] sm:max-w-[320px] bg-[#FFFFFF] border-r border-[#C4B9A3] shadow-2xl flex flex-col p-4 sm:p-5 text-[#111311] overflow-y-auto h-full"
      >
        <div className="flex flex-col h-full justify-between space-y-4">
          <div className="space-y-4">
            {/* Drawer Header: Corporate Branding + Close Button */}
            <div className="flex items-start justify-between pb-3.5 border-b border-[#EAE4D5]">
              <div className="flex items-center space-x-3 min-w-0">
                <div className="p-2.5 bg-[#1E3A8A] rounded-xl shadow-xs text-white shrink-0">
                  <Milk className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <div className="min-w-0">
                  <span className="font-extrabold text-sm sm:text-base leading-tight block text-[#111311] truncate">
                    Shakarganj
                  </span>
                  <span className="text-[9px] sm:text-[10px] uppercase font-extrabold text-slate-500 tracking-wider block truncate">
                    Food Products Limited
                  </span>
                </div>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => {
                  onClose();
                  setTimeout(() => triggerButtonRef?.current?.focus(), 0);
                }}
                className="min-h-[44px] min-w-[44px] p-2.5 rounded-xl border border-[#EAE4D5] bg-[#FDFBF9] text-slate-700 hover:bg-[#F4F0E6] hover:text-[#111311] transition flex items-center justify-center shrink-0 focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
                aria-label="Close navigation drawer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Role Header Indicator */}
            <div className="px-1 py-0.5">
              <span className="text-[10px] uppercase font-black tracking-wider text-slate-500 block">
                {currentUser?.role?.replace(/_/g, ' ') || 'Workspace'}
              </span>
            </div>

            {/* Hierarchical Navigation Tree */}
            <nav aria-label="Role Navigation" className="space-y-2">
              {sections.map((section) => {
                const SectionIcon = section.icon;
                const hasChildren = Boolean(section.children && section.children.length > 0);
                const isExpanded = Boolean(expandedSections[section.id]);
                const isSectionDirectActive = !hasChildren && isSectionActive(section);
                const sectionContainsActiveLeaf = hasChildren && section.children?.some((leaf) => isLeafActive(leaf.href));

                if (!hasChildren && section.href) {
                  // Direct Leaf Section (e.g. Overview, Yard Status Board)
                  return (
                    <button
                      key={section.id}
                      type="button"
                      data-href={section.href}
                      onClick={() => handleLeafClick(section.href!)}
                      className={`w-full min-h-[44px] flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-black transition-all border text-left ${
                        isSectionDirectActive
                          ? 'bg-[#1E3A8A] text-white border-[#1E3A8A] shadow-md'
                          : 'bg-[#FDFBF9] text-[#111311] border-[#EAE4D5] hover:bg-[#F4F0E6] hover:border-[#C4B9A3]'
                      }`}
                      aria-current={isSectionDirectActive ? 'page' : undefined}
                    >
                      <div className="flex items-center space-x-3 min-w-0">
                        {SectionIcon && (
                          <SectionIcon
                            className={`w-4 h-4 shrink-0 ${
                              isSectionDirectActive ? 'text-white' : 'text-[#1E3A8A]'
                            }`}
                          />
                        )}
                        <span className="truncate">{section.label}</span>
                      </div>
                      {isSectionDirectActive && (
                        <span className="w-2 h-2 rounded-full bg-emerald-400 ring-4 ring-emerald-400/30 shrink-0" />
                      )}
                    </button>
                  );
                }

                // Expandable Parent Section
                return (
                  <div key={section.id} className="space-y-1">
                    <button
                      type="button"
                      onClick={() => handleToggleSection(section.id)}
                      className={`w-full min-h-[44px] flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-black transition-all border text-left ${
                        sectionContainsActiveLeaf
                          ? 'bg-blue-50/70 border-blue-200 text-[#1E3A8A]'
                          : 'bg-[#FDFBF9] text-[#111311] border-[#EAE4D5] hover:bg-[#F4F0E6] hover:border-[#C4B9A3]'
                      }`}
                      aria-expanded={isExpanded}
                      aria-controls={`nav-section-${section.id}`}
                    >
                      <div className="flex items-center space-x-3 min-w-0">
                        {SectionIcon && (
                          <SectionIcon
                            className={`w-4 h-4 shrink-0 ${
                              sectionContainsActiveLeaf ? 'text-[#1E3A8A]' : 'text-slate-600'
                            }`}
                          />
                        )}
                        <span className="truncate">{section.label}</span>
                      </div>
                      <span className="text-slate-500 shrink-0 ml-2">
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 text-[#1E3A8A]" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </span>
                    </button>

                    {/* Children Leaves */}
                    {isExpanded && hasChildren && (
                      <div
                        id={`nav-section-${section.id}`}
                        className="pl-3.5 ml-3 border-l-2 border-[#EAE4D5] space-y-1 py-1"
                      >
                        {section.children!.map((leaf) => {
                          const LeafIcon = leaf.icon;
                          const isActive = isLeafActive(leaf.href);

                          return (
                            <button
                              key={leaf.id}
                              type="button"
                              data-href={leaf.href}
                              onClick={() => handleLeafClick(leaf.href)}
                              className={`w-full min-h-[40px] flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-all text-left ${
                                isActive
                                  ? 'bg-[#1E3A8A] text-white font-black shadow-xs'
                                  : 'text-slate-700 hover:bg-[#F4F0E6] hover:text-[#111311] font-bold'
                              }`}
                              aria-current={isActive ? 'page' : undefined}
                            >
                              <div className="flex items-center space-x-2.5 min-w-0">
                                {LeafIcon && (
                                  <LeafIcon
                                    className={`w-3.5 h-3.5 shrink-0 ${
                                      isActive ? 'text-white' : 'text-slate-500'
                                    }`}
                                  />
                                )}
                                <span className="truncate">{leaf.label}</span>
                              </div>
                              {isActive && (
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0 ml-1.5" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </nav>
          </div>

          {/* User Signout Footer / Meta Info */}
          <div className="pt-3 border-t border-[#EAE4D5] text-[11px] text-slate-500 flex items-center justify-between">
            <span className="truncate font-medium">
              {currentUser?.name || 'Operator'}
            </span>
            <span className="font-mono text-[10px] text-slate-400">
              v6G-E
            </span>
          </div>
        </div>
      </aside>
    </div>
  );
};
