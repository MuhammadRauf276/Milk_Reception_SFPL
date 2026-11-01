'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Lock, AlertCircle, Eye, EyeOff, CheckCircle } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/frontend/context/ToastContext';

export function ReAuthModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [expiredUrl, setExpiredUrl] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    const handleAuthExpired = (e: Event) => {
      const customEvent = e as CustomEvent<{ url?: string; timestamp?: number }>;
      setExpiredUrl(customEvent.detail?.url || null);
      setIsOpen(true);
      setErrorMsg(null);
    };

    window.addEventListener('milk-auth-expired', handleAuthExpired);
    return () => window.removeEventListener('milk-auth-expired', handleAuthExpired);
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    setPassword('');
    setErrorMsg(null);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setErrorMsg('Please enter both username and password.');
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          password,
          rememberMe: true,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Authentication failed. Please verify your credentials.');
      }

      // Success! Dispatch auth restored event
      window.dispatchEvent(
        new CustomEvent('milk-auth-restored', {
          detail: { user: data.user, timestamp: Date.now() },
        })
      );

      toast.showSuccess(
        'Session re-authenticated successfully. Your unsaved form inputs are preserved.',
        'Session Restored'
      );
      handleClose();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal
      title="Session Expired"
      description="Re-authenticate to continue without losing your current form inputs"
      onClose={handleClose}
      preventClose={submitting}
      size="sm"
    >
      <div className="p-6 space-y-4" data-testid="reauth-modal">
        <div className="flex items-center gap-3 border-b border-border pb-3">
          <div className="p-2 rounded-xl bg-amber-50 text-amber-600 border border-amber-200">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground">Session Expired</h3>
            <p className="text-xs text-muted-foreground">
              Log in to continue without losing your entered data.
            </p>
          </div>
        </div>

        {errorMsg && (
          <div
            className="flex items-start gap-2 p-3 text-xs rounded-lg bg-destructive/10 text-destructive border border-destructive/20"
            role="alert"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div className="space-y-1.5">
            <Label htmlFor="reauth-username" className="text-xs font-semibold text-foreground">
              Username
            </Label>
            <Input
              id="reauth-username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. operator"
              required
              disabled={submitting}
              className="text-sm h-10"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reauth-password" className="text-xs font-semibold text-foreground">
              Password
            </Label>
            <div className="relative">
              <Input
                id="reauth-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                required
                disabled={submitting}
                className="text-sm h-10 pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                disabled={submitting}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 text-xs"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="pt-2 flex flex-col gap-2">
            <Button
              type="submit"
              disabled={submitting}
              className="w-full h-11 text-sm font-semibold"
            >
              {submitting ? (
                <>
                  <Spinner className="w-4 h-4 mr-2" />
                  Verifying…
                </>
              ) : (
                'Resume & Save Inputs'
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={handleClose}
              className="w-full h-9 text-xs text-muted-foreground"
            >
              Dismiss (inputs remain on screen)
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
