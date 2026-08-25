'use client';

import React, { useState, useEffect } from 'react';
import { Milk, ShieldCheck, ArrowRight, CheckCircle2, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { useRouter } from 'next/navigation';

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

export const LoginPage: React.FC = () => {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [devGroups, setDevGroups] = useState<DevGroup[]>([]);

  // Fetch dev profiles ONLY when enabled in dev mode
  useEffect(() => {
    async function loadDevProfiles() {
      if (
        process.env.NODE_ENV !== 'production' &&
        process.env.NEXT_PUBLIC_ENABLE_DEV_LOGIN_PROFILES === 'true'
      ) {
        try {
          const res = await fetch('/api/auth/dev-profiles');
          if (res.ok) {
            const data = await res.json();
            setDevGroups(data.profiles || []);
          }
        } catch (_err) {
          // Dev profiles optional
        }
      }
    }
    loadDevProfiles();
  }, []);

  const handleCardSelect = (item: DevItem) => {
    setUsername(item.username);
    if (item.password) {
      setPassword(item.password);
    }
    setSelectedUser(item.username);
    setErrorMsg(null);
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

      const role = data.user?.role;
      if (role === 'SUPER_ADMIN') {
        router.push('/super-admin');
      } else if (role === 'Production_Operator' || role === 'PRODUCTION_OPERATOR' || role === 'Production') {
        router.push('/department/production');
      } else if (role === 'MPD_Operator' || role === 'MPD') {
        router.push('/department/mpd');
      } else if (role === 'Security_Operator' || role === 'Security_Weight') {
        router.push('/department/security');
      } else if (role === 'Security_Manager') {
        router.push('/department/security-manager');
      } else if (role === 'QA_Operator' || role === 'QA') {
        router.push('/department/qa');
      } else if (role === 'WEIGHBRIDGE_OPERATOR' || role === 'Weighbridge_Operator') {
        router.push('/department/weighbridge');
      } else if (role === 'ZMCC_MANAGER') {
        router.push('/department/zmcc-manager');
      } else if (
        role === 'MPD_Zone_Manager' ||
        role === 'General_Plant_Manager' ||
        role === 'Management' ||
        role === 'QA_Manager' ||
        role === 'Production_Manager' ||
        role === 'Admin'
      ) {
        router.push('/management/dashboard');
      } else {
        router.push('/department/production');
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Invalid username or password');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-screen bg-[#F4EFE3] text-[#111311] flex flex-col justify-between p-6 font-sans">
      {/* Top Brand Bar */}
      <div className="flex items-center justify-between max-w-6xl mx-auto w-full pb-4 border-b border-[#C4B9A3]">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-[#1E3A8A] rounded-xl shadow-md text-white">
            <Milk className="w-6 h-6" />
          </div>
          <div>
            <h1 className="font-extrabold text-lg tracking-tight leading-none text-[#111311]">MilkReception</h1>
            <p className="text-[10px] font-bold text-[#1E40AF] uppercase tracking-widest mt-0.5">
              Shakarganj Milk Reception Management System
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-[#EFE9D9] border border-[#C4B9A3] text-xs font-mono font-extrabold text-[#111311]">
          <ShieldCheck className="w-4 h-4 text-[#1E40AF]" />
          <span>Operational Security Console</span>
        </div>
      </div>

      {/* Main Container */}
      <div className="max-w-6xl mx-auto w-full my-auto py-8">
        <div className="flex flex-col lg:flex-row gap-8 items-start justify-center">
          {/* Main Visual Focus: Sign In Form (First on Mobile, Right on Desktop) */}
          <div className="w-full lg:w-[420px] shrink-0 order-1 lg:order-2">
            <div className="p-7 rounded-2xl bg-[#EFE9D9] border border-[#C4B9A3] shadow-lg space-y-6 text-[#111311]">
              <div className="space-y-1">
                <h2 className="text-2xl font-black text-[#111311]">Sign In</h2>
                <p className="text-xs text-[#334155] font-bold">Enter your operational account credentials</p>
              </div>

              {errorMsg && (
                <div role="alert" className="p-3.5 rounded-xl bg-rose-100 border border-rose-300 text-rose-800 text-xs font-bold flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="username-input" className="block text-xs font-extrabold text-[#111311]">
                    Username
                  </label>
                  <input
                    id="username-input"
                    type="text"
                    name="username"
                    autoComplete="username"
                    value={username}
                    onChange={handleUsernameChange}
                    placeholder="Enter your username"
                    className="w-full px-3.5 py-2.5 text-xs font-mono font-extrabold rounded-xl border border-[#C4B9A3] bg-white text-[#111311] focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="password-input" className="block text-xs font-extrabold text-[#111311]">
                    Password
                  </label>
                  <div className="relative">
                    <input
                      id="password-input"
                      type={showPassword ? 'text' : 'password'}
                      name="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={handlePasswordChange}
                      placeholder="••••••••"
                      className="w-full px-3.5 py-2.5 pr-10 text-xs font-mono font-extrabold rounded-xl border border-[#C4B9A3] bg-white text-[#111311] focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-800 focus:outline-none"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <label className="flex items-center space-x-2 text-xs font-bold text-[#334155] cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="w-4 h-4 rounded border-[#C4B9A3] text-[#1E3A8A] focus:ring-[#1E3A8A]"
                    />
                    <span>Remember me</span>
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full flex items-center justify-center space-x-2 py-3 px-4 rounded-xl bg-[#1E3A8A] hover:bg-[#1E40AF] text-white font-extrabold text-xs shadow-md transition disabled:opacity-50"
                >
                  <span>{isSubmitting ? 'Signing in...' : 'Sign In'}</span>
                  <ArrowRight className="w-4 h-4 text-white" />
                </button>
              </form>
            </div>
          </div>

          {/* Secondary Utility: Development Access Panel (Rendered ONLY in Dev Mode when flag enabled) */}
          {devGroups.length > 0 && (
            <div className="flex-1 w-full space-y-4 order-2 lg:order-1">
              <div className="space-y-1">
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-amber-100 border border-amber-300 text-amber-900 inline-block uppercase tracking-wider">
                  Development Utility
                </span>
                <h3 className="text-xl font-black text-[#111311]">Development Access</h3>
                <p className="text-xs text-[#334155] font-semibold">
                  Select a test account to fill the sign-in form.
                </p>
              </div>

              <div className="space-y-4 max-h-[520px] overflow-y-auto pr-1">
                {devGroups.map((group) => (
                  <div key={group.group} className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 block px-1">
                      {group.group}
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {group.items.map((item) => {
                        const active = selectedUser === item.username;
                        return (
                          <div
                            key={item.username}
                            onClick={() => handleCardSelect(item)}
                            tabIndex={0}
                            role="button"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                handleCardSelect(item);
                              }
                            }}
                            className={`p-3 rounded-xl border transition cursor-pointer space-y-1 flex flex-col justify-between ${
                              active
                                ? 'bg-[#1E3A8A] text-white border-blue-900 shadow-md ring-2 ring-[#1E3A8A]'
                                : 'bg-[#EFE9D9] text-[#111311] border-[#C4B9A3] hover:bg-amber-100/60'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span
                                className={`px-2 py-0.5 rounded text-[9.5px] font-black uppercase font-mono ${
                                  active ? 'bg-white/20 text-white' : 'bg-[#F4EFE3] text-[#1E40AF] border border-[#C4B9A3]'
                                }`}
                              >
                                {item.label}
                              </span>
                              {active && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                            </div>

                            <div className="pt-1">
                              <p className={`text-[10px] font-semibold truncate ${active ? 'text-slate-200' : 'text-[#334155]'}`}>
                                {item.department}
                              </p>
                            </div>

                            <div className={`p-1.5 rounded-lg font-mono text-[10.5px] flex justify-between items-center ${
                              active ? 'bg-blue-950/60 text-white' : 'bg-[#F4EFE3] text-[#111311] border border-[#C4B9A3]'
                            }`}>
                              <span className="opacity-75 text-[9.5px]">User:</span>
                              <span className="font-extrabold">{item.username}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="max-w-6xl mx-auto w-full pt-4 border-t border-[#C4B9A3] text-center text-xs font-bold text-slate-500">
        Shakarganj Milk Reception Management System &copy; {new Date().getFullYear()} — Operational System Access
      </div>
    </div>
  );
};
