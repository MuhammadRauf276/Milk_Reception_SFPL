'use client';

import { useState } from 'react';
import { Search, X, Plus } from 'lucide-react';
import { motion } from 'framer-motion';
import { fadeSlide } from '@/components/motion/presets';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { useDebouncedValue } from '@/lib/query/useDebouncedValue';
import { Pager, pageCount, paginate } from '../../dashboard/components/Pager';
import type { ContractorItem, SourceFeedback } from './sourceTypes';

export function ContractorsPanel({
  contractors,
  onFeedback,
  onChanged,
}: {
  contractors: ContractorItem[];
  onFeedback: (f: SourceFeedback) => void;
  onChanged: () => Promise<unknown>;
}) {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<ContractorItem | null>(null);
  const [erpInput, setErpInput] = useState('');
  const [isAddingContractor, setIsAddingContractor] = useState(false);
  const [newForm, setNewForm] = useState({ name: '', code: '', erp_code: '' });
  const [submitting, setSubmitting] = useState(false);

  const term = debouncedSearch.trim().toLowerCase();
  const filtered = contractors.filter(
    (con) =>
      !term ||
      con.code.toLowerCase().includes(term) ||
      con.name.toLowerCase().includes(term) ||
      (con.erp_code && con.erp_code.toLowerCase().includes(term))
  );
  const totalPages = pageCount(filtered.length);
  const rows = paginate(filtered, Math.min(page, totalPages));

  const openEdit = (contractor: ContractorItem) => {
    setEditing(contractor);
    setErpInput(contractor.erp_code || '');
    onFeedback(null);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch('/api/mpd/sources/contractors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newForm.name.trim(),
          code: newForm.code.trim().toUpperCase(),
          erp_code: newForm.erp_code.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to register direct contractor.');
      onFeedback({
        type: 'success',
        message: `Direct contractor "${newForm.name}" registered successfully.`,
      });
      setIsAddingContractor(false);
      setNewForm({ name: '', code: '', erp_code: '' });
      await onChanged();
    } catch (err) {
      onFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Error registering contractor.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/mpd/sources/contractors', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractor_source_id: editing.id, erp_code: erpInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update contractor ERP code.');
      onFeedback({
        type: 'success',
        message: `Contractor "${editing.name}" ERP code updated to ${erpInput.trim()}.`,
      });
      setEditing(null);
      await onChanged();
    } catch (err) {
      onFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Error updating contractor ERP code.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const columns: DataColumn<ContractorItem>[] = [
    {
      key: 'code',
      header: 'Contractor Code',
      label: 'Contractor code',
      primary: true,
      cell: (contractor) => <span className="font-mono font-semibold text-foreground">{contractor.code}</span>,
    },
    { key: 'name', header: 'Name', label: 'Name', cell: (contractor) => <span className="font-semibold text-foreground">{contractor.name}</span> },
    {
      key: 'erp',
      header: 'Assigned ERP Code',
      label: 'Assigned ERP code',
      cell: (contractor) =>
        contractor.erp_code ? (
          <span className="font-mono font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
            [{contractor.erp_code}]
          </span>
        ) : (
          <span className="text-amber-700 font-semibold">Missing</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      label: 'Status',
      cell: (contractor) => (
        <span
          className={`px-2 py-0.5 rounded-md text-xs font-semibold ${
            contractor.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-muted text-muted-foreground'
          }`}
        >
          {contractor.is_active ? 'Active' : 'Inactive'}
        </span>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      label: 'Action',
      actions: true,
      align: 'right',
      cell: (contractor) => (
        <button
          type="button"
          onClick={() => openEdit(contractor)}
          className="min-h-11 px-3 py-1 text-xs font-semibold text-primary hover:bg-subtle rounded-lg transition min-w-11"
        >
          Edit ERP code
        </button>
      ),
    },
  ];

  return (
    <motion.div
      key="contractors"
      variants={fadeSlide}
      initial="initial"
      animate="animate"
      className="bg-card border-border rounded-2xl border p-4 space-y-4 shadow-2xs"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-3 top-4" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search"
            className="w-full min-h-11 pl-8 pr-3 py-2 border border-border rounded-lg text-xs font-semibold focus:ring-2 focus:ring-primary outline-hidden"
          />
        </div>

        <button
            type="button"
            onClick={() => {
              setNewForm({ name: '', code: '', erp_code: '' });
              setIsAddingContractor(true);
            }}
            className="flex min-h-11 items-center justify-center space-x-1 px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg text-xs font-semibold transition shadow-2xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Register Direct Contractor</span>
          </button>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(contractor) => contractor.id}
        emptyTitle="No contractors found."
        tableFrom="lg"
      />

      <Pager page={Math.min(page, totalPages)} totalPages={totalPages} total={filtered.length} onPageChange={setPage} />

      {editing && (
        <Drawer open onOpenChange={(o) => !o && setEditing(null)}>
          <DrawerContent>
            <div className="space-y-4 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5">
              <DrawerTitle className="sr-only">Contractor ERP Code</DrawerTitle>
              <div className="flex items-center justify-between pb-3 border-b border-border">
                <h3 className="text-sm font-semibold text-foreground">Contractor ERP Code</h3>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => setEditing(null)}
                  className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground hover:text-secondary-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSave} className="space-y-3 text-xs">
                <div className="bg-card border-border p-3 rounded-xl border space-y-1">
                  <div>
                    Contractor: <strong className="text-foreground">{editing.name}</strong>
                  </div>
                  <div>
                    Code: <strong className="font-mono text-foreground">{editing.code}</strong>
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-foreground mb-1">
                    Official ERP Code <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={erpInput}
                    onChange={(e) => setErpInput(e.target.value)}
                    placeholder="e.g. 500124"
                    className="w-full min-h-11 px-3 py-2 border border-border rounded-lg font-semibold bg-card"
                  />
                </div>

                <div className="flex justify-end space-x-2 pt-3 border-t border-border">
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    className="min-h-11 px-4 py-2 border border-border rounded-lg text-secondary-foreground font-semibold hover:bg-subtle"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="min-h-11 px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg font-semibold transition disabled:opacity-50"
                  >
                    {submitting ? 'Saving…' : 'Save ERP code'}
                  </button>
                </div>
              </form>
            </div>
          </DrawerContent>
        </Drawer>
      )}

      {isAddingContractor && (
        <Drawer open onOpenChange={(o) => !o && setIsAddingContractor(false)}>
          <DrawerContent>
            <div className="space-y-4 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5">
              <DrawerTitle className="sr-only">Register Direct Plant Contractor</DrawerTitle>
              <div className="flex items-center justify-between pb-3 border-b border-border">
                <h3 className="text-sm font-semibold text-foreground">Register Direct Plant Contractor</h3>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => setIsAddingContractor(false)}
                  className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground hover:text-secondary-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleCreate} className="space-y-3 text-xs">
                <div>
                  <label className="block font-semibold text-foreground mb-1">
                    Contractor Name <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={newForm.name}
                    onChange={(e) => setNewForm((p) => ({ ...p, name: e.target.value }))}
                    placeholder="e.g. Al-Madina Milk Transport"
                    className="w-full min-h-11 px-3 py-2 border border-border rounded-lg font-semibold bg-card"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-foreground mb-1">
                    Contractor Code <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={newForm.code}
                    onChange={(e) => setNewForm((p) => ({ ...p, code: e.target.value.toUpperCase() }))}
                    placeholder="e.g. CONT-001"
                    className="w-full min-h-11 px-3 py-2 border border-border rounded-lg font-mono font-semibold bg-card"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-foreground mb-1">
                    Official ERP Code <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={newForm.erp_code}
                    onChange={(e) => setNewForm((p) => ({ ...p, erp_code: e.target.value }))}
                    placeholder="e.g. 500124"
                    className="w-full min-h-11 px-3 py-2 border border-border rounded-lg font-semibold bg-card"
                  />
                </div>

                <div className="flex justify-end space-x-2 pt-3 border-t border-border">
                  <button
                    type="button"
                    onClick={() => setIsAddingContractor(false)}
                    className="min-h-11 px-4 py-2 border border-border rounded-lg text-secondary-foreground font-semibold hover:bg-subtle"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="min-h-11 px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg font-semibold transition disabled:opacity-50"
                  >
                    {submitting ? 'Registering…' : 'Register Contractor'}
                  </button>
                </div>
              </form>
            </div>
          </DrawerContent>
        </Drawer>
      )}
    </motion.div>
  );
}
