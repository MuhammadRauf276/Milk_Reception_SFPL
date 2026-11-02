'use client';

import React, { useState } from 'react';
import { ShieldCheck, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { BrandMark } from '@/frontend/modules/shared/navigation/NavPanel';
import { resolveRoleHome } from '@/lib/role-routing';

export const LoginPage: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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
    <div className="flex min-h-screen w-full flex-col justify-between bg-background text-foreground">
      {/* Top Header */}
      <header className="mx-auto flex h-20 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <BrandMark size="lg" />
        <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
          Secure operator access
        </span>
      </header>

      {/* Center Sign-in Form Card */}
      <main className="mx-auto flex w-full max-w-6xl flex-1 items-center justify-center px-4 py-8 sm:px-6">
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
          className="w-full max-w-[420px] rounded-xl border bg-card p-6 shadow-sm sm:p-8"
          aria-labelledby="sign-in-heading"
        >
          <div>
            <h1 id="sign-in-heading" className="text-xl font-semibold tracking-tight text-foreground">
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
                <div className="mt-5 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">
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

            <Button type="submit" disabled={isSubmitting} className="h-11 w-full font-semibold">
              {isSubmitting ? <Spinner className="text-primary-foreground" /> : null}
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </motion.section>
      </main>

      {/* Footer */}
      <footer suppressHydrationWarning className="mx-auto w-full max-w-6xl px-4 py-6 text-center text-xs text-muted-foreground sm:px-6">
        © {new Date().getFullYear()} Shakarganj Food Products Ltd · Milk Reception &amp; Processing
      </footer>
    </div>
  );
};
