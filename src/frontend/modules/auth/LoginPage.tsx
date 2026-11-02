'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { ShieldCheck, AlertCircle, Eye, EyeOff, LogIn, Search } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { BrandMark } from '@/frontend/modules/shared/navigation/NavPanel';
import { resolveRoleHome } from '@/lib/role-routing';

interface DevItem {
  label: string;
  department: string;
  username: string;
  password?: string;
}

interface DevGroup {
  group: string;
  items: DevItem[];
}

// Development-only quick-login cards. Fails closed: completely disabled when NODE_ENV is 'production'
// or when NEXT_PUBLIC_ENABLE_DEV_LOGIN_PROFILES is explicitly 'false'.
const DEV_LOGIN_PROFILES_ENABLED =
  process.env.NODE_ENV !== 'production' &&
  process.env.NEXT_PUBLIC_ENABLE_DEV_LOGIN_PROFILES !== 'false';

const STATIC_DEV_PROFILES: DevGroup[] = !DEV_LOGIN_PROFILES_ENABLED
  ? []
  : [
      {
        group: 'Directorate',
        items: [
          { label: 'Super Admin', department: 'System Administration', username: 'admin.superuser', password: 'admin123' },
          { label: 'Data Executive', department: 'Data & Analytics', username: 'data.executive', password: 'data123' },
          { label: 'Executive', department: 'Executive Management', username: 'executive.management', password: 'exec123' },
          { label: 'Finance', department: 'Finance & Accounts', username: 'finance.accounts', password: 'finance123' },
        ],
      },
      {
        group: 'Managers',
        items: [
          { label: 'MPD Head', department: 'Milk Procurement', username: 'mpd.head', password: 'mpdhead123' },
          { label: 'ZMCC Mgr, Hasilpur', department: 'Milk Procurement (Hasilpur)', username: 'zmcc.manager.hasilpur', password: 'zone123' },
          { label: 'ZMCC Mgr, Jhang', department: 'Milk Procurement (Jhang)', username: 'zmcc.manager.jhang', password: 'zone123' },
          { label: 'QA Head', department: 'Quality Assurance', username: 'qa.head', password: 'qahead123' },
          { label: 'Production Head', department: 'Production', username: 'production.head', password: 'prodhead123' },
          { label: 'Admin Head', department: 'Administration', username: 'admin.head', password: 'adminhead123' },
          { label: 'Contractor Mgr, Al Khair', department: 'Milk Procurement (Al Khair)', username: 'contractor.manager.alkhair', password: 'contractor123' },
        ],
      },
      {
        group: 'FIELD & PLANT OPERATORS',
        items: [
          { label: 'PHE, Hasilpur', department: 'Milk Procurement (Hasilpur)', username: 'phe.operator', password: 'phe123' },
          { label: 'MDO, Hasilpur', department: 'Milk Procurement (Hasilpur)', username: 'mdo.hasilpur', password: 'mdo123' },
          { label: 'ZMCC Lab, Hasilpur', department: 'Milk Procurement (Hasilpur)', username: 'zmcc.operator', password: 'mpd123' },
          { label: 'ZMCC Lab, Jhang', department: 'Milk Procurement (Jhang)', username: 'zmcc.operator.jhang', password: 'mpd123' },
          { label: 'ZMCC Lab, Kabirwala', department: 'Milk Procurement (Kabirwala)', username: 'zmcc.operator.kabirwala', password: 'mpd123' },
          { label: 'Mobile Tester · Usman Ali', department: 'Milk Procurement (Hasilpur)', username: 'mot.usman', password: 'mot123' },
          { label: 'Mobile Tester · Kashif Raza', department: 'Milk Procurement (Hasilpur)', username: 'mot.kashif', password: 'mot123' },
          { label: 'Mobile Tester · Bilal Ahmed', department: 'Milk Procurement (Hasilpur)', username: 'mot.bilal', password: 'mot123' },
          { label: 'Mobile Tester · MOT Operator', department: 'Milk Procurement (Hasilpur)', username: 'mot.driver', password: 'mot123' },
          { label: 'QAE', department: 'Quality Assurance Lab', username: 'qa.chemist', password: 'qa123' },
          { label: 'Weighbridge Operator', department: 'Production & Weighbridge', username: 'weighbridge.operator', password: 'weighbridge123' },
          { label: 'Weighbridge Shift Operator 2', department: 'Production & Weighbridge', username: 'weighbridge.02', password: 'weighbridge123' },
          { label: 'Production Operator', department: 'Plant Production & Silos', username: 'production.operator', password: 'production123' },
          { label: 'Gate Operator', department: 'Administration', username: 'security.gate', password: 'security123' },
        ],
      },
      {
        group: 'CONTRACTORS',
        items: [
          { label: 'Contractor, Al Khair', department: 'Milk Procurement - Contractor Operations', username: 'contractor.operator.alkhair', password: 'mpd123' },
          { label: 'Contractor, Al Mehmood', department: 'Milk Procurement - Contractor Operations', username: 'contractor.operator.almehmood', password: 'mpd123' },
        ],
      },
    ];

function formatGroupName(name: string): string {
  if (name.toUpperCase() === 'FIELD & PLANT OPERATORS') return 'Field & Operators';
  if (name.toUpperCase() === 'CONTRACTORS') return 'Contractors';
  if (name.toUpperCase() === 'DIRECTORATE') return 'Directorate';
  if (name.toUpperCase() === 'MANAGERS') return 'Managers';
  return name;
}

export const LoginPage: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [devGroups, setDevGroups] = useState<DevGroup[]>(STATIC_DEV_PROFILES);
  const [selectedGroup, setSelectedGroup] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  useEffect(() => {
    if (!DEV_LOGIN_PROFILES_ENABLED) return;
    let alive = true;
    fetch('/api/auth/dev-profiles')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!alive || !data?.profiles?.length) return;
        setDevGroups(data.profiles);
      })
      .catch(() => {
        // Fallback to static dev profiles if fetch fails
      });
    return () => {
      alive = false;
    };
  }, []);

  const handleUsernameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUsername(e.target.value);
    setErrorMsg(null);
  };

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPassword(e.target.value);
    setErrorMsg(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMsg(null);

    const trimmedUsername = username.trim();

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: trimmedUsername,
          password,
          rememberMe,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Invalid username or password');
      }

      const destination = resolveRoleHome(data.user?.role);
      // Full reload so the workspace boots with the new session; the login page leaves history.
      window.location.replace(destination);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Invalid username or password');
      setIsSubmitting(false);
    }
  };

  const handleDirectLogin = async (item: DevItem) => {
    setUsername(item.username);
    const pass = item.password || 'admin123';
    setPassword(pass);
    setSelectedUser(item.username);
    setErrorMsg(null);
    setIsSubmitting(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: item.username,
          password: pass,
          rememberMe: true,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Invalid username or password');
      }

      const destination = resolveRoleHome(data.user?.role);
      // Full reload so the workspace boots with the new session; the login page leaves history.
      window.location.replace(destination);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Login failed');
      setIsSubmitting(false);
      setSelectedUser(null);
    }
  };

  const totalDevUsers = useMemo(() => {
    return devGroups.reduce((acc, g) => acc + g.items.length, 0);
  }, [devGroups]);

  const filteredGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return devGroups
      .map((g) => {
        if (selectedGroup !== 'ALL' && g.group.toLowerCase() !== selectedGroup.toLowerCase()) {
          return null;
        }
        const filteredItems = g.items.filter((item) => {
          if (!q) return true;
          return (
            item.label.toLowerCase().includes(q) ||
            item.username.toLowerCase().includes(q) ||
            item.department.toLowerCase().includes(q)
          );
        });
        if (filteredItems.length === 0) return null;
        return {
          group: g.group,
          items: filteredItems,
        };
      })
      .filter((g): g is DevGroup => Boolean(g));
  }, [devGroups, selectedGroup, searchQuery]);

  return (
    <div className="flex min-h-[100dvh] w-full flex-col bg-background text-foreground pt-safe pb-safe">
      <header className="mx-auto flex h-20 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <BrandMark size="lg" />
        <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex">
          <ShieldCheck className="h-3.5 w-3.5" />
          Secure operator access
        </span>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center px-4 py-8 sm:px-6">
        {/* Main Sign in card */}
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
          className="w-full max-w-[420px] rounded-xl border bg-card p-6 shadow-sm sm:p-8"
          aria-labelledby="sign-in-heading"
        >
          <div>
            <h1 id="sign-in-heading" className="text-xl font-semibold tracking-tight">
              Sign in
            </h1>
          </div>

          <AnimatePresence initial={false}>
            {errorMsg && (
              <motion.div
                role="alert"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-5 flex items-start gap-2 rounded-md border border-border bg-card px-3 py-2.5 text-sm text-rose-800">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                  <span>{errorMsg}</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username-input">Username</Label>
              <Input
                id="username-input"
                type="text"
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={username}
                onChange={handleUsernameChange}
                placeholder="Enter your username"
                className="h-11"
                aria-invalid={Boolean(errorMsg)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password-input">Password</Label>
              <div className="relative">
                <Input
                  id="password-input"
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={handlePasswordChange}
                  className="h-11 pr-11"
                  aria-invalid={Boolean(errorMsg)}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 flex items-center px-3.5 text-muted-foreground hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <label className="flex w-fit cursor-pointer select-none items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              Keep me signed in
            </label>

            <Button type="submit" disabled={isSubmitting} className="h-11 w-full">
              {isSubmitting ? <Spinner className="text-primary-foreground" /> : null}
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </motion.section>

        {/* Development Quick Sign-In Section - ONLY visible in local run / development */}
        {DEV_LOGIN_PROFILES_ENABLED && devGroups.length > 0 ? (
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.1, ease: [0.25, 0.1, 0.25, 1] }}
            className="mt-10 w-full max-w-5xl rounded-xl border bg-card p-5 shadow-sm sm:p-6"
            aria-labelledby="dev-accounts-heading"
          >
            <div className="flex flex-col gap-4 border-b border-border/60 pb-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h2 id="dev-accounts-heading" className="text-base font-semibold tracking-tight text-foreground">
                    Quick test sign-in
                  </h2>
                  <span className="rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium tracking-wide text-amber-700 dark:text-amber-400">
                    Local run only
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Click any account below to sign in instantly and open its assigned screen. Hidden in live production.
                </p>
              </div>

              <div className="relative w-full sm:w-64">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Filter accounts…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-9 pl-8 text-xs"
                />
              </div>
            </div>

            {/* Filter Pills */}
            <div className="mt-4 flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSelectedGroup('ALL')}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                  selectedGroup === 'ALL'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                All ({totalDevUsers})
              </button>
              {devGroups.map((g) => {
                const isSelected = selectedGroup.toLowerCase() === g.group.toLowerCase();
                return (
                  <button
                    type="button"
                    key={g.group}
                    onClick={() => setSelectedGroup(isSelected ? 'ALL' : g.group)}
                    className={cn(
                      'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                      isSelected
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    {formatGroupName(g.group)} ({g.items.length})
                  </button>
                );
              })}
            </div>

            {/* Account Cards Grid */}
            <div className="mt-5 space-y-6">
              {filteredGroups.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  No accounts found matching your filter.
                </div>
              ) : (
                filteredGroups.map((group) => (
                  <div key={group.group}>
                    <p className="mb-2 px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      {formatGroupName(group.group)}
                    </p>
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                      {group.items.map((item) => {
                        const active = selectedUser === item.username;
                        const busy = active && isSubmitting;
                        return (
                          <button
                            type="button"
                            key={item.username}
                            onClick={() => handleDirectLogin(item)}
                            disabled={isSubmitting}
                            title={`Sign in as ${item.label} (${item.username})`}
                            className={cn(
                              'group flex flex-col justify-between rounded-lg border p-3 text-left transition-all hover:border-primary/50 hover:bg-muted/50 hover:shadow-2xs focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60',
                              active ? 'border-primary bg-primary/5' : 'border-border bg-card'
                            )}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-semibold text-foreground group-hover:text-primary">
                                  {item.label}
                                </span>
                                <span className="block truncate text-xs font-mono text-muted-foreground">
                                  {item.username}
                                </span>
                              </div>
                              {busy ? (
                                <Spinner className="h-4 w-4 shrink-0 text-primary" />
                              ) : (
                                <LogIn className="h-4 w-4 shrink-0 text-muted-foreground opacity-40 transition-opacity group-hover:opacity-100 group-hover:text-primary" />
                              )}
                            </div>
                            <div className="mt-2.5 flex items-center justify-between border-t border-border/40 pt-2 text-[11px] text-muted-foreground">
                              <span className="truncate">{item.department}</span>
                              <span className="shrink-0 font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                                Open
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </motion.section>
        ) : null}
      </main>

      <footer suppressHydrationWarning className="mx-auto w-full max-w-6xl px-4 py-6 text-center text-xs text-muted-foreground sm:px-6">
        © {new Date().getFullYear()} Shakarganj Food Products Ltd · Milk Reception &amp; Processing
      </footer>
    </div>
  );
};
