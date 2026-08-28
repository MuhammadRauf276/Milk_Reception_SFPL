'use client';

import React from 'react';
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
  isOpen?: boolean;
  onClose?: () => void;
}

export const SuperAdminSidebar: React.FC<SuperAdminSidebarProps> = ({
  currentUser,
  isOpen = false,
  onClose,
}) => {
  const pathname = usePathname();

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

  const handleLinkClick = () => {
    if (onClose) {
      onClose();
    }
  };

  const sidebarContent = (
    <aside className="w-64 shrink-0 bg-[#FFFFFF] border-r border-[#EAE4D5]/80 flex flex-col justify-between p-4 min-h-screen text-[#111311]">
      <div className="space-y-4">
        {/* BRANDING HEADER */}
        <div className="flex items-center justify-between pb-3 border-b border-[#EAE4D5]/80">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-[#1E3A8A] rounded-xl shadow-sm text-white">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-bold tracking-tight text-[#111311] text-sm leading-none">
                Super Admin
              </h1>
              <p className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider mt-1">
                Control Panel
              </p>
            </div>
          </div>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="md:hidden p-2 rounded-xl text-slate-500 hover:bg-slate-100 min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-label="Close sidebar"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* NAVIGATION LINKS */}
        <nav className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href || (item.href !== '/super-admin' && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={handleLinkClick}
                className={`flex items-center space-x-2.5 px-3 py-2.5 min-h-[44px] rounded-xl text-xs font-bold transition-colors ${
                  isActive
                    ? 'bg-[#1E3A8A] text-white shadow-sm font-extrabold'
                    : 'text-slate-700 hover:bg-[#F4F0E6] hover:text-[#111311]'
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-500'}`} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* USER INFO FOOTER */}
      <div className="pt-3 border-t border-[#EAE4D5]/80 text-[11px] text-slate-500 space-y-1">
        <div className="font-extrabold text-[#111311] truncate">{currentUser?.name || 'Super Admin'}</div>
        <div className="text-[10px] text-slate-400 truncate">{currentUser?.department || 'System Operations'}</div>
      </div>
    </aside>
  );

  return (
    <>
      {/* Desktop Sidebar (Permanent) */}
      <div className="hidden md:flex md:shrink-0">
        {sidebarContent}
      </div>

      {/* Mobile Off-Canvas Drawer */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden" role="dialog" aria-modal="true">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
            onClick={onClose}
          />
          {/* Slide-over Container */}
          <div className="relative flex flex-col w-64 max-w-[80vw] bg-white shadow-2xl z-10 animate-in slide-in-from-left duration-200">
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  );
};
