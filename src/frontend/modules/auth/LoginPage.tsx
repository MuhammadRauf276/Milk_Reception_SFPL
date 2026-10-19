'use client';

import React, { useState } from 'react';
import { ShieldCheck, ArrowRight, AlertCircle, Eye, EyeOff, LogIn } from 'lucide-react';
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

// Development-only quick-login cards. Fail closed: the profile list (and its passwords) is
// empty unless this is a non-production build AND NEXT_PUBLIC_ENABLE_DEV_LOGIN_PROFILES === 'true'.
const DEV_LOGIN_PROFILES_ENABLED =
  process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_ENABLE_DEV_LOGIN_PROFILES === 'true';

const STATIC_DEV_PROFILES: DevGroup[] = !DEV_LOGIN_PROFILES_ENABLED ? [] : [
  {
    group: 'DIRECTORATE & GOVERNANCE',
    items: [
      { label: 'Super Admin', department: 'System Administration', username: 'admin.superuser', password: 'admin123' },
      { label: 'Data Executive', department: 'Data & Analytics / QA Rules', username: 'data.executive', password: 'data123' },
      { label: 'Senior Executive Management', department: 'Executive Management', username: 'executive.management', password: 'exec123' },
      { label: 'Finance and Accounts', department: 'Finance & Accounts', username: 'finance.accounts', password: 'finance123' },
    ],
  },
  {
    group: 'MANAGERS & HEADS',
    items: [
      { label: 'MPD Head', department: 'Milk Procurement Directorate', username: 'mpd.head', password: 'mpdhead123' },
      { label: 'ZMCC Manager (Hasilpur)', department: 'Milk Procurement (Hasilpur)', username: 'zmcc.manager.hasilpur', password: 'zone123' },
      { label: 'ZMCC Manager (Jhang)', department: 'Milk Procurement (Jhang)', username: 'zmcc.manager.jhang', password: 'zone123' },
      { label: 'AVP, QA Reception Lab', department: 'Quality Assurance Directorate', username: 'qa.head', password: 'qahead123' },
      { label: 'Manager, QA Reception Lab', department: 'Quality Assurance Management', username: 'qa.manager', password: 'qamgr123' },
      { label: 'Production Head', department: 'Production Directorate', username: 'production.head', password: 'prodhead123' },
      { label: 'Admin Head', department: 'Administration Directorate', username: 'admin.head', password: 'adminhead123' },
      { label: 'Plant Contractor Manager (Al Khair)', department: 'Milk Procurement (Al Khair)', username: 'contractor.manager.alkhair', password: 'contractor123' },
    ],
  },
  {
    group: 'FIELD & PLANT OPERATORS',
    items: [
      { label: 'PHE Operator (Hasilpur)', department: 'Milk Procurement (Hasilpur)', username: 'phe.operator', password: 'phe123' },
      { label: 'MDO (Hasilpur)', department: 'Milk Procurement (Hasilpur)', username: 'mdo.hasilpur', password: 'mdo123' },
      { label: 'MDO (Jhang)', department: 'Milk Procurement (Jhang)', username: 'mdo.jhang', password: 'mdo123' },
      { label: 'ZMCC Lab Attendant (Hasilpur)', department: 'Milk Procurement (Hasilpur)', username: 'zmcc.operator', password: 'mpd123' },
      { label: 'ZMCC Lab Attendant (Jhang)', department: 'Milk Procurement (Jhang)', username: 'zmcc.operator.jhang', password: 'mpd123' },
      { label: 'ZMCC Lab Attendant (Kabirwala)', department: 'Milk Procurement (Kabirwala)', username: 'zmcc.operator.kabirwala', password: 'mpd123' },
      { label: 'Mobile Tester (MOT), Hasilpur', department: 'Milk Procurement (Hasilpur)', username: 'mot.driver', password: 'mot123' },
      { label: 'QAE, Reception Lab', department: 'Quality Assurance Lab', username: 'qa.chemist', password: 'qa123' },
      { label: 'Weighbridge Operator (Shift 1)', department: 'Production & Weighbridge', username: 'weighbridge.operator', password: 'weighbridge123' },
      { label: 'Weighbridge Operator (Shift 2)', department: 'Production & Weighbridge', username: 'weighbridge.02', password: 'weighbridge123' },
      { label: 'Production Reception Operator', department: 'Plant Production & Silos', username: 'production.operator', password: 'production123' },
      { label: 'Security Gate Operator', department: 'Security', username: 'security.gate', password: 'security123' },
    ],
  },
  {
    group: 'CONTRACTORS',
    items: [
      { label: 'Contractor Operator (Al Khair)', department: 'Milk Procurement - Contractor Operations', username: 'contractor.operator.alkhair', password: 'mpd123' },
      { label: 'Contractor Operator (Al Mehmood)', department: 'Milk Procurement - Contractor Operations', username: 'contractor.operator.almehmood', password: 'mpd123' },
    ],
  },
];

export const LoginPage: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [devGroups] = useState<DevGroup[]>(STATIC_DEV_PROFILES);

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
    }
  };

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

  return (
    <div className="flex min-h-screen w-full flex-col bg-background text-foreground">
      <header className="mx-auto flex h-20 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <BrandMark size="lg" />
        <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex">
          <ShieldCheck className="h-3.5 w-3.5" />
          Secure operator access
        </span>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 items-start justify-center px-4 py-8 sm:px-6 lg:items-center">
        <div className="grid w-full items-start gap-8 lg:grid-cols-[400px_1fr] lg:gap-12">
          <motion.section
            initial={false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
            className="mx-auto w-full max-w-[400px] rounded-xl border bg-card p-6 shadow-xs sm:p-8"
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
                  <div className="mt-5 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
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
                  placeholder="e.g. qa.chemist"
                  className="h-10"
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
                    value={password}
                    onChange={handlePasswordChange}
                    className="h-10 pr-10"
                    aria-invalid={Boolean(errorMsg)}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
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

              <Button type="submit" disabled={isSubmitting} className="h-10 w-full">
                {isSubmitting ? <Spinner className="text-primary-foreground" /> : null}
                {isSubmitting ? 'Signing in…' : 'Sign in'}
                {!isSubmitting ? <ArrowRight /> : null}
              </Button>
            </form>
          </motion.section>

          {devGroups.length > 0 ? (
          <motion.section
            initial={false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.08, ease: [0.25, 0.1, 0.25, 1] }}
            className="mx-auto w-full max-w-[640px] lg:mx-0"
            aria-labelledby="station-accounts-heading"
          >
            <div className="mb-3 flex items-end justify-between gap-4">
              <div>
                <h2 id="station-accounts-heading" className="text-sm font-semibold">
                  Station accounts
                </h2>
              </div>
            </div>

            <div className="scrollbar-thin max-h-[560px] space-y-5 overflow-y-auto rounded-xl border bg-card p-3 shadow-2xs">
              {devGroups.map((group) => (
                <div key={group.group}>
                  <p className="px-2 pb-1.5 pt-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    {group.group.toLowerCase()}
                  </p>
                  <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                    {group.items.map((item) => {
                      const active = selectedUser === item.username;
                      const busy = active && isSubmitting;
                      return (
                        <li key={item.username}>
                          <button
                            type="button"
                            onClick={() => handleDirectLogin(item)}
                            disabled={isSubmitting}
                            aria-label={`Sign in as ${item.label}`}
                            className={cn(
                              'group flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait',
                              active ? 'border-primary/30 bg-primary/5' : 'border-transparent hover:bg-muted'
                            )}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-foreground">{item.label}</span>
                              <span className="block truncate text-xs text-muted-foreground">{item.username}</span>
                            </span>
                            {busy ? (
                              <Spinner className="text-primary" />
                            ) : (
                              <LogIn className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </motion.section>
          ) : null}
        </div>
      </main>

      <footer suppressHydrationWarning className="mx-auto w-full max-w-6xl px-4 py-6 text-center text-xs text-muted-foreground sm:px-6">
        © {new Date().getFullYear()} Shakarganj Food Products Ltd · Milk Reception &amp; Processing
      </footer>
    </div>
  );
};
