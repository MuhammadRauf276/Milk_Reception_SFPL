'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  Truck,
  Database,
  FlaskConical,
  BookOpen,
  AlertTriangle,
  Activity,
  History,
  FolderTree,
  Settings,
  ShieldCheck,
  X,
} from 'lucide-react';
import { User } from '@core/types';

interface SuperAdminSidebarProps {
  currentUser: User | null;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export const SuperAdminSidebar: React.FC<SuperAdminSidebarProps> = ({
  currentUser,
  isMobileOpen = false,
  onCloseMobile,
}) => {
  const pathname = usePathname();

  // Close drawer on Escape key press
  useEffect(() => {
    if (!isMobileOpen || !onCloseMobile) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseMobile();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMobileOpen, onCloseMobile]);

  // Lock body scroll when mobile drawer is open
  useEffect(() => {
    if (isMobileOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isMobileOpen]);

  const handleLinkClick = () => {
    if (onCloseMobile) {
      onCloseMobile();
    }
  };

  const navItems = [
    { href: '/super-admin', label: 'Overview', icon: LayoutDashboard },
    { href: '/super-admin/users', label: 'Users & Access', icon: Users },
    { href: '/super-admin/procurement-sources', label: 'Procurement Sources', icon: Truck },
    { href: '/super-admin/silos', label: 'Silos', icon: Database },
    { href: '/super-admin/lab-tests', label: 'Lab Test Master', icon: FlaskConical },
    { href: '/super-admin/sop-rules', label: 'SOP Rules', icon: BookOpen },
    { href: '/super-admin/qa-warnings', label: 'QA Warnings', icon: AlertTriangle },
    { href: '/super-admin/operations', label: 'Operations', icon: Activity },
    { href: '/super-admin/audit', label: 'Audit & Corrections', icon: History },
    { href: '/super-admin/master-data', label: 'Master Data', icon: FolderTree },
    { href: '/super-admin/settings', label: 'System Settings', icon: Settings },
  ];

  const renderSidebarBody = (isDrawer: boolean = false) => (
    <div className="flex flex-col justify-between h-full space-y-4">
      <div className="space-y-4">
        {/* BRANDING HEADER */}
        <div className="flex items-center justify-between pb-3 border-b border-[#C4B9A3]">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-[#1E3A8A] rounded-xl shadow-xs text-white shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-black tracking-tight text-[#111311] text-sm leading-none">
                Super Admin
              </h1>
              <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider mt-1">
                Control Panel
              </p>
            </div>
          </div>

          {/* Close button for mobile drawer */}
          {isDrawer && onCloseMobile && (
            <button
              type="button"
              onClick={onCloseMobile}
              className="xl:hidden p-2 rounded-xl border border-[#C4B9A3] text-slate-600 hover:text-[#111311] hover:bg-[#EFE9D9]/60 transition"
              aria-label="Close navigation drawer"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* NAVIGATION LINKS */}
        <nav className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              pathname === item.href ||
              (item.href !== '/super-admin' && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={handleLinkClick}
                className={`flex items-center space-x-2.5 px-3 py-2.5 min-h-[44px] rounded-xl text-xs font-black transition-colors ${
                  isActive
                    ? 'bg-[#1E3A8A] text-white shadow-xs'
                    : 'text-slate-700 hover:bg-[#EFE9D9]/60 hover:text-[#111311]'
                }`}
              >
                <Icon
                  className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-[#1E3A8A]'}`}
                />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* USER INFO FOOTER */}
      <div className="pt-3 border-t border-[#C4B9A3] text-[11px] text-slate-500 space-y-0.5">
        <div className="font-black text-[#111311] truncate">
          {currentUser?.name || 'Super Admin'}
        </div>
        <div className="text-[10px] text-slate-500 font-mono truncate">
          {currentUser?.department || 'System Operations'}
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Permanent Sidebar (>= 1280px) */}
      <aside className="hidden xl:flex w-64 shrink-0 bg-white border-r border-[#C4B9A3] flex-col justify-between p-4 min-h-screen text-[#111311]">
        {renderSidebarBody(false)}
      </aside>

      {/* Mobile/Tablet Off-Canvas Drawer (< 1280px) */}
      {isMobileOpen && (
        <div className="xl:hidden">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40"
            onClick={onCloseMobile}
            aria-hidden="true"
          />

          {/* Drawer Panel */}
          <aside
            className="fixed inset-y-0 left-0 z-50 w-72 max-w-[80vw] sm:max-w-[280px] bg-white border-r border-[#C4B9A3] shadow-2xl flex flex-col justify-between p-4 text-[#111311] overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation Drawer"
          >
            {renderSidebarBody(true)}
          </aside>
        </div>
      )}
    </>
  );
};
