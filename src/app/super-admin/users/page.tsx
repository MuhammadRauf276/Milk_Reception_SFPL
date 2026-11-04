'use client';

import { useAutoClearMessage } from '@/frontend/hooks/useAutoClearMessage';
import { InfoTip } from '@/components/ui/info-tip';
import React, { useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, KeyRound, Edit2, ShieldAlert, CheckCircle2, MoreHorizontal, UserX, UserCheck, Search } from 'lucide-react';
import { CREATABLE_ROLES, CreatableRole, ROLE_ASSIGNMENT_POLICIES } from '@/lib/user-assignment-policy';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { fadeSlide } from '@/components/motion/presets';
import { getErrorMessage } from '@/lib/errors';
import { fetchJson } from '@/lib/query/fetchJson';
import { useDebouncedValue } from '@/frontend/modules/super-admin/shared/useDebouncedValue';
import { PaginationBar } from '@/frontend/modules/super-admin/shared/PaginationBar';
import { TableWrapper } from '@/components/ui/table-wrapper';
import { UserFormDrawer } from '@/frontend/modules/super-admin/users/UserFormDrawer';
import { UserStatusDrawer } from '@/frontend/modules/super-admin/users/UserStatusDrawer';
import { UserResetPasswordDrawer } from '@/frontend/modules/super-admin/users/UserResetPasswordDrawer';
import type { UserItem, UsersResponse } from '@/frontend/modules/super-admin/users/types';

const PAGE_SIZE = 25;
const ROLE_FILTER_OPTIONS = [
  { value: '', label: 'All roles' },
  ...CREATABLE_ROLES.map((r) => ({ value: r, label: ROLE_ASSIGNMENT_POLICIES[r].label, keywords: r })),
];
const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Deactivated' },
] as const;

type Dialog =
  | { kind: 'create' }
  | { kind: 'edit'; user: UserItem }
  | { kind: 'reset'; user: UserItem }
  | { kind: 'status'; user: UserItem; targetStatus: boolean }
  | null;

export default function SuperAdminUsersPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  useAutoClearMessage(successMsg, setSuccessMsg);

  const q = useDebouncedValue(search.trim(), 300);
  const filters = useMemo(() => ({ q, role: roleFilter, status: statusFilter, page }), [q, roleFilter, statusFilter, page]);

  const usersQuery = useQuery({
    queryKey: ['super-admin', 'users', filters],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (q) params.set('q', q);
      if (roleFilter) params.set('role', roleFilter);
      if (statusFilter) params.set('status', statusFilter);
      return fetchJson<UsersResponse>(`/api/super-admin/users?${params}`, { signal });
    },
    placeholderData: keepPreviousData,
  });

  const users = usersQuery.data?.users ?? [];
  const pagination = usersQuery.data?.pagination;
  const error = usersQuery.error ? getErrorMessage(usersQuery.error) || 'Failed to load users.' : null;

  const closeDialog = () => setDialog(null);
  const handleSaved = (message: string) => {
    setSuccessMsg(message);
    setDialog(null);
    void queryClient.invalidateQueries({ queryKey: ['super-admin', 'users'] });
  };

  const updateFilter = (fn: () => void) => {
    fn();
    setPage(1);
  };

  return (
    <div className="w-full min-w-0 max-w-full space-y-4 overflow-x-hidden">
      {error && (
        <div className="flex items-center space-x-2 rounded-xl border border-border bg-card p-4 text-xs font-semibold text-rose-800 animate-panel-in">
          <ShieldAlert className="h-4 w-4 shrink-0 text-rose-600" />
          <span>{error}</span>
        </div>
      )}

      <AnimatePresence initial={false}>
        {successMsg && (
          <motion.div
            key="ok"
            variants={fadeSlide}
            initial="initial"
            animate="animate"
            exit="exit"
            role="status"
            className="flex items-center space-x-2 rounded-xl border border-border bg-card p-4 text-xs font-semibold text-emerald-800"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            <span>{successMsg}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-border/80 bg-card shadow-2xs">
        <div className="space-y-3 border-b border-border p-3 sm:px-4 sm:py-3">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <div className="flex min-w-0 items-center space-x-2">
              <div className="flex items-center gap-1.5"><h2 className="text-sm font-semibold text-foreground">Users</h2><InfoTip text="Manage system users, access credentials, and role jurisdictions." /></div>
              <span className="rounded-full border border-border bg-subtle px-2 py-0.5 text-[11px] tabular-nums text-slate-600">
                {pagination?.totalRecords ?? users.length}
              </span>
            </div>
            <Button className="h-11 px-4" onClick={() => setDialog({ kind: 'create' })}>
              <Plus />
              Add user
            </Button>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-[minmax(0,1fr)_14rem_auto]">
            <div className="relative min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={(e) => updateFilter(() => setSearch(e.target.value))}
                placeholder="Search users…"
                aria-label="Search users"
                className="h-11 w-full rounded-xl border border-border-strong bg-card pl-9 pr-3 text-sm focus:outline-hidden focus:border-primary"
              />
            </div>
            <div className="min-w-0"><Combobox
              options={ROLE_FILTER_OPTIONS}
              value={roleFilter}
              onValueChange={(v) => updateFilter(() => setRoleFilter(v))}
              placeholder="All roles"
              searchPlaceholder="Search roles"
            /></div>
            <div role="group" aria-label="Status filter" className="flex min-w-0 gap-1">
              {STATUS_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={statusFilter === o.value}
                  onClick={() => updateFilter(() => setStatusFilter(o.value))}
                  className={`h-11 flex-1 rounded-xl border px-3 text-xs font-semibold ${
                    statusFilter === o.value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border-strong bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <TableWrapper>
          <table className="w-full min-w-[700px] text-left text-xs">
            <thead className="border-b border-border bg-subtle text-slate-600">
              <tr>
                <th className="p-3 font-semibold">User</th>
                <th className="p-3 font-semibold">Email</th>
                <th className="p-3 font-semibold">Role</th>
                <th className="p-3 font-semibold">Department</th>
                <th className="p-3 font-semibold">Data Scope</th>
                <th className="p-3 font-semibold">Last Login</th>
                <th className="p-3 font-semibold">Status</th>
                <th className="p-3 text-right font-semibold">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 font-medium">
              {usersQuery.isPending ? (
                <tr>
                  <td colSpan={8} className="p-6 text-center tabular-nums text-slate-400">
                    Loading users…
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-slate-400">
                    No users found.
                  </td>
                </tr>
              ) : (
                users.map((u) => {
                  const displayScope = u.scopeType === 'PROCUREMENT_SOURCE' ? 'SOURCE' : u.scopeType;
                  return (
                    <tr key={u.id} className={`hover:bg-slate-50 ${usersQuery.isPlaceholderData ? 'opacity-60' : ''}`}>
                      <td className="p-3">
                        <div className="font-semibold text-foreground">{u.name}</div>
                        <div className="text-[10px] tabular-nums text-slate-500">@{u.username}</div>
                      </td>
                      <td className="p-3 text-[11px] tabular-nums text-slate-600">
                        {u.email ? (
                          u.email
                        ) : (
                          <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                            Not set
                          </span>
                        )}
                      </td>
                      <td className="p-3">
                        <span
                          className={`inline-block whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-medium ${
                            u.role === 'SUPER_ADMIN' ? 'bg-primary/10 text-primary' : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {ROLE_ASSIGNMENT_POLICIES[u.role as CreatableRole]?.label || u.role}
                        </span>
                      </td>
                      <td className="p-3 text-slate-600">{u.department || '—'}</td>
                      <td className="p-3">
                        <div className="font-semibold text-slate-700">{displayScope}</div>
                        {u.procurementSource && (
                          <div className="text-[10px] tabular-nums text-slate-500">
                            {u.procurementSource.name} ({u.procurementSource.sourceType})
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap p-3 text-[11px] tabular-nums text-slate-500">
                        {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never'}
                      </td>
                      <td className="p-3">
                        {u.isActive ? (
                          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-700">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
                            <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
                            Deactivated
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="h-11 w-11" aria-label={`Actions for ${u.name}`}>
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuItem onSelect={() => setDialog({ kind: 'edit', user: u })}>
                              <Edit2 />
                              Edit details
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setDialog({ kind: 'reset', user: u })}>
                              <KeyRound />
                              Reset password
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              destructive={u.isActive}
                              onSelect={() => setDialog({ kind: 'status', user: u, targetStatus: !u.isActive })}
                            >
                              {u.isActive ? <UserX /> : <UserCheck />}
                              {u.isActive ? 'Deactivate' : 'Activate'}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </TableWrapper>
        <PaginationBar
          page={pagination?.page ?? page}
          totalPages={pagination?.totalPages ?? 1}
          totalRecords={pagination?.totalRecords ?? users.length}
          noun="users"
          disabled={usersQuery.isFetching}
          onPageChange={setPage}
        />
      </div>

      {dialog?.kind === 'create' && <UserFormDrawer key="create" user={null} open onClose={closeDialog} onSaved={handleSaved} />}
      {dialog?.kind === 'edit' && (
        <UserFormDrawer key={`edit-${dialog.user.id}`} user={dialog.user} open onClose={closeDialog} onSaved={handleSaved} />
      )}
      {dialog?.kind === 'reset' && (
        <UserResetPasswordDrawer key={`reset-${dialog.user.id}`} user={dialog.user} open onClose={closeDialog} onSaved={(m) => { setSuccessMsg(m); setDialog(null); }} />
      )}
      {dialog?.kind === 'status' && (
        <UserStatusDrawer
          key={`status-${dialog.user.id}`}
          user={dialog.user}
          targetStatus={dialog.targetStatus}
          open
          onClose={closeDialog}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
