'use client';

import { useAutoClearMessage } from '@/frontend/hooks/useAutoClearMessage';
import { InfoTip } from '@/components/ui/info-tip';
import React, { useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, KeyRound, Edit2, ShieldAlert, CheckCircle2, MoreHorizontal, UserX, UserCheck, } from 'lucide-react';
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
import { DataFilters, FilterToggle, type ActiveFilter } from '@/components/ui/data-filters';
import { DataTable, type BulkAction, type DataColumn } from '@/components/ui/data-table';
import { confirmAction } from '@/components/ui/confirm-dialog';
import { formatDateTime } from '@/lib/format';
import { AuthorityBadge } from '@/frontend/modules/shared/AuthorityBadge';
import { UserFormDrawer } from '@/frontend/modules/super-admin/users/UserFormDrawer';
import { UserStatusDrawer } from '@/frontend/modules/super-admin/users/UserStatusDrawer';
import { UserResetPasswordDrawer } from '@/frontend/modules/super-admin/users/UserResetPasswordDrawer';
import type { UserItem, UsersResponse } from '@/frontend/modules/super-admin/users/types';
import { useListPageSize } from '@/components/ui/pagination';

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
  const PAGE_SIZE = useListPageSize();
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
    queryKey: ['super-admin', 'users', filters, PAGE_SIZE],
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
  const updateFilter = (fn: () => void) => {
    fn();
    setPage(1);
  };

  const setUsersActive = async (rows: UserItem[], isActive: boolean) => {
    const verb = isActive ? 'Activate' : 'Deactivate';
    const ok = await confirmAction({
      title: `${verb} ${rows.length} user${rows.length === 1 ? '' : 's'}?`,
      description: isActive ? 'They will be able to sign in again.' : 'They will not be able to sign in until activated.',
      confirmLabel: verb,
      destructive: !isActive,
    });
    if (!ok) return;
    const results = await Promise.allSettled(
      rows.map((u) =>
        fetchJson(`/api/super-admin/users/${u.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isActive }),
        })
      )
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    const done = rows.length - failed;
    setSuccessMsg(failed ? `${done} updated. ${failed} could not be changed.` : `${done} updated.`);
    await queryClient.invalidateQueries({ queryKey: ['super-admin', 'users'] });
  };

  const bulkActions: BulkAction<UserItem>[] = [
    { label: 'Activate', onRun: (rows) => setUsersActive(rows, true) },
    { label: 'Deactivate', destructive: true, onRun: (rows) => setUsersActive(rows, false) },
  ];

  const activeFilters: ActiveFilter[] = [
    ...(roleFilter
      ? [{ key: 'role', label: ROLE_ASSIGNMENT_POLICIES[roleFilter as CreatableRole]?.label ?? roleFilter, onClear: () => updateFilter(() => setRoleFilter('')) }]
      : []),
    ...(statusFilter
      ? [{ key: 'status', label: statusFilter === 'active' ? 'Active' : 'Deactivated', onClear: () => updateFilter(() => setStatusFilter('')) }]
      : []),
  ];

  const columns: DataColumn<UserItem>[] = [
    {
      key: 'user',
      header: 'User',
      label: 'User',
      primary: true,
      cell: (u) => (
        <div className="min-w-0">
          <div className="font-medium text-foreground">{u.name}</div>
          <div className="break-words text-xs text-muted-foreground">@{u.username}</div>
          {u.email ? <div className="break-words text-xs text-muted-foreground">{u.email}</div> : <div className="text-xs text-amber-700">Email not set</div>}
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      label: 'Role',
      cell: (u) => (
        <div className="flex flex-wrap items-center gap-1">
          <span>{ROLE_ASSIGNMENT_POLICIES[u.role as CreatableRole]?.label || u.role}</span>
          <AuthorityBadge role={u.role} />
        </div>
      ),
    },
    { key: 'department', header: 'Department', label: 'Department', defaultHidden: true, cell: (u) => u.department || '—' },
    {
      key: 'scope',
      header: 'Data scope',
      label: 'Data scope',
      cell: (u) =>
        u.procurementSource ? (
          <span>{u.procurementSource.name}</span>
        ) : (
          <span className="text-secondary-foreground">{u.scopeType === 'PROCUREMENT_SOURCE' ? 'Source' : u.scopeType === 'SYSTEM' ? 'All' : u.scopeType}</span>
        ),
    },
    { key: 'login', header: 'Last login', label: 'Last login', cell: (u) => <span className="tabular-nums">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Never'}</span> },
    {
      key: 'status',
      header: 'Status',
      label: 'Status',
      cell: (u) => (
        <span className={`inline-flex items-center gap-1 text-sm ${u.isActive ? 'text-emerald-700' : 'text-muted-foreground'}`}>
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${u.isActive ? 'bg-emerald-500' : 'bg-border-strong'}`} />
          {u.isActive ? 'Active' : 'Deactivated'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      label: 'Actions',
      actions: true,
      align: 'right',
      cell: (u) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Actions for ${u.name}`}>
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
            <DropdownMenuItem destructive={u.isActive} onSelect={() => setDialog({ kind: 'status', user: u, targetStatus: !u.isActive })}>
              {u.isActive ? <UserX /> : <UserCheck />}
              {u.isActive ? 'Deactivate' : 'Activate'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const handleSaved = (message: string) => {
    setSuccessMsg(message);
    setDialog(null);
    void queryClient.invalidateQueries({ queryKey: ['super-admin', 'users'] });
  };

  return (
    <div className="w-full min-w-0 max-w-full space-y-4">
      {error && (
        <div className="flex items-center space-x-2 rounded-2xl border border-border bg-card p-4 text-xs font-semibold text-rose-800 animate-panel-in">
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
            className="flex items-center space-x-2 rounded-2xl border border-border bg-card p-4 text-xs font-semibold text-emerald-800"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            <span>{successMsg}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="w-full min-w-0 max-w-full rounded-2xl border border-border/80 bg-card shadow-2xs">
        <div className="space-y-3 border-b border-border p-3 sm:px-4 sm:py-3">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <div className="flex min-w-0 items-center space-x-2">
              <div className="flex items-center gap-2"><h2 className="text-sm font-semibold text-foreground">Users</h2><InfoTip text="Manage system users, access credentials, and role jurisdictions." /></div>
              <span className="rounded-md border border-border bg-subtle px-2 py-0.5 text-xs tabular-nums text-secondary-foreground">
                {pagination?.totalRecords ?? users.length}
              </span>
            </div>
            <Button className="h-11 px-4" onClick={() => setDialog({ kind: 'create' })}>
              <Plus />
              Add user
            </Button>
          </div>
          <DataFilters
            search={search}
            onSearchChange={(v) => updateFilter(() => setSearch(v))}
            searchPlaceholder="Search users"
            active={activeFilters}
          >
            <div className="min-w-[min(100%,14rem)] flex-1 sm:max-w-64">
              <Combobox
                options={ROLE_FILTER_OPTIONS}
                value={roleFilter}
                onValueChange={(v) => updateFilter(() => setRoleFilter(v))}
                placeholder="All roles"
                searchPlaceholder="Search roles"
              />
            </div>
            <FilterToggle
              label="Status filter"
              options={STATUS_OPTIONS}
              value={statusFilter}
              onChange={(v) => updateFilter(() => setStatusFilter(v))}
            />
          </DataFilters>
        </div>

        <div className="p-3 sm:p-4">
          <DataTable paginate={false}
            columns={columns}
            rows={users}
            getRowId={(u) => String(u.id)}
            loading={usersQuery.isPending}
            stale={usersQuery.isPlaceholderData}
            emptyTitle="No users found"
            emptyDescription={activeFilters.length ? 'Try removing a filter.' : undefined}
            bulkActions={bulkActions}
            columnPickerId="super-admin-users"
            tableFrom="lg"
          />
        </div>
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
