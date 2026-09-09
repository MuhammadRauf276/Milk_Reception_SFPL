'use client';

import React, { useEffect, useRef, useCallback } from 'react';
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
  Shield,
  X,
} from 'lucide-react';
import { User } from '@core/types';

export interface SuperAdminSidebarProps {
  currentUser?: User | null;
  isOpen?: boolean;
  isMobileOpen?: boolean;
  onClose?: () => void;
  onCloseMobile?: () => void;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
}

export const SuperAdminSidebar: React.FC<SuperAdminSidebarProps> = ({
  isOpen,
  isMobileOpen,
  onClose,
  onCloseMobile,
  triggerRef,
}) => {
  const pathname = usePathname();
  const drawerOpen = Boolean(isOpen ?? isMobileOpen);
  const closeHandler = onClose ?? onCloseMobile;

  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);

  const handleClose = useCallback(() => {
    if (closeHandler) {
      closeHandler();
    }
    setTimeout(() => {
      triggerRef?.current?.focus();
    }, 0);
  }, [closeHandler, triggerRef]);

  // Focus management, body scroll lock, and Escape key listener
  useEffect(() => {
    if (drawerOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';

      // Move focus into the drawer when opened
      const focusTimer = setTimeout(() => {
        closeButtonRef.current?.focus();
      }, 50);

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          handleClose();
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => {
        clearTimeout(focusTimer);
        document.body.style.overflow = originalOverflow;
        window.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [drawerOpen, handleClose]);

  // Focus trap: keep Tab and Shift+Tab trapped inside the open drawer
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

  const handleLinkClick = () => {
    handleClose();
  };

  const navItems = [
    { href: '/super-admin', label: 'Overview', icon: LayoutDashboard },
    { href: '/super-admin/users', label: 'Users', icon: Users },
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

  if (!drawerOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex"
      role="dialog"
      aria-modal="true"
      aria-label="Super Admin Navigation Drawer"
      onKeyDown={handleDrawerKeyDown}
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity"
        onClick={handleClose}
        aria-hidden="true"
      />

      {/* Drawer Panel */}
      <aside
        ref={drawerRef}
        className="relative z-50 w-80 max-w-[85vw] sm:max-w-[320px] bg-[#FFFFFF] border-r border-[#C4B9A3] shadow-2xl flex flex-col p-4 sm:p-5 text-[#111311] overflow-y-auto h-full"
      >
        <div className="flex flex-col h-full">
          {/* Drawer Header: Corporate Branding + Close Button */}
          <div className="flex items-start justify-between pb-4 border-b border-[#EAE4D5] shrink-0">
            <div className="flex items-center space-x-3 min-w-0">
              <div className="p-2 bg-[#EFE9D9]/60 rounded-xl border border-[#C4B9A3] shrink-0">
                <Shield className="w-5 h-5 text-[#1E3A8A]" />
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
              onClick={handleClose}
              className="min-h-[44px] min-w-[44px] p-2.5 rounded-xl border border-[#C4B9A3] bg-[#FDFBF9] text-slate-700 hover:bg-[#F4F0E6] hover:text-[#111311] transition flex items-center justify-center shrink-0 focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
              aria-label="Close navigation drawer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation Links */}
          <nav aria-label="Super Admin Navigation" className="space-y-1.5 mt-4 flex-1">
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
                  aria-current={isActive ? 'page' : undefined}
                  className={`flex items-center space-x-2.5 px-3.5 py-2.5 min-h-[44px] rounded-xl text-xs font-black transition-all border ${
                    isActive
                      ? 'bg-[#1E3A8A] text-white border-[#1E3A8A] shadow-xs'
                      : 'bg-[#FDFBF9] text-slate-700 border-[#EAE4D5] hover:bg-[#EFE9D9]/60 hover:text-[#111311] hover:border-[#C4B9A3]'
                  } focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]`}
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
      </aside>
    </div>
  );
};
