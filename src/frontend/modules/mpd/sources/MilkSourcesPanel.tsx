'use client';

import { useState } from 'react';
import { Edit2, Plus, Search, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { fadeSlide } from '@/components/motion/presets';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { useDebouncedValue } from '@/lib/query/useDebouncedValue';
import { Pager, pageCount, paginate } from '../../dashboard/components/Pager';
import type { ErpSourceItem, SourceFeedback, ZmccOption } from './sourceTypes';

type SourceForm = { erp_code: string; name: string; is_active: boolean; zmcc_ids: string[] };
const EMPTY_FORM: SourceForm = { erp_code: '', name: '', is_active: true, zmcc_ids: [] };

export function MilkSourcesPanel({
  sources,
  zmccOptions,
  onFeedback,
  onChanged,
}: {
  sources: ErpSourceItem[];
  zmccOptions: ZmccOption[];
  onFeedback: (f: SourceFeedback) => void;
  onChanged: () => Promise<unknown>;
}) {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [page, setPage] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<ErpSourceItem | null>(null);
  const [form, setForm] = useState<SourceForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const term = debouncedSearch.trim().toLowerCase();
  const filtered = sources.filter(
    (src) => !term || src.erp_code.toLowerCase().includes(term) || src.name.toLowerCase().includes(term)
  );
  const totalPages = pageCount(filtered.length);
  const rows = paginate(filtered, Math.min(page, totalPages));

  const openAdd = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    onFeedback(null);
    setDrawerOpen(true);
  };

  const openEdit = (source: ErpSourceItem) => {
    setEditing(source);
    setForm({
      erp_code: source.erp_code,
      name: source.name,
      is_active: source.is_active,
      zmcc_ids: source.zmcc_visibilities.filter((v) => v.is_active).map((v) => v.zmcc_id),
    });
    onFeedback(null);
    setDrawerOpen(true);
  };

  const toggleZmcc = (zmccId: string) => {
    setForm((prev) => {
      const exists = prev.zmcc_ids.includes(zmccId);
      return { ...prev, zmcc_ids: exists ? prev.zmcc_ids.filter((id) => id !== zmccId) : [...prev.zmcc_ids, zmccId] };
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (editing) {
        const res = await fetch(`/api/mpd/sources/erp-sources/${editing.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: form.name.trim(),
            erp_code: form.erp_code.trim(),
            is_active: form.is_active,
            zmcc_ids: form.zmcc_ids,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to update milk source.');
        onFeedback({ type: 'success', message: `Milk source "${form.name}" updated.` });
      } else {
        const res = await fetch('/api/mpd/sources/erp-sources', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            erp_code: form.erp_code.trim(),
            name: form.name.trim(),
            zmcc_ids: form.zmcc_ids,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create milk source.');
        onFeedback({ type: 'success', message: `Milk source "${form.name}" created.` });
      }
      setDrawerOpen(false);
      await onChanged();
    } catch (err) {
      onFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Error saving milk source.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.div
      key="sources"
      variants={fadeSlide}
      initial="initial"
      animate="animate"
      className="bg-white rounded-xl border border-border p-4 space-y-4 shadow-2xs"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-4" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search by ERP code or source name…"
            className="w-full min-h-11 pl-8 pr-3 py-1.5 border border-border rounded-xl text-xs font-semibold focus:ring-2 focus:ring-primary outline-hidden"
          />
        </div>

        <button
          type="button"
          onClick={openAdd}
          className="flex min-h-11 items-center justify-center space-x-1 px-3.5 py-2 bg-primary hover:bg-primary-hover text-white rounded-xl text-xs font-semibold transition shadow-2xs"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Create Milk Source</span>
        </button>
      </div>

      <div className="overflow-x-auto border border-border rounded-xl">
        <table className="w-full text-left text-xs">
          <thead className="bg-subtle text-slate-600 font-semibold border-b border-border">
            <tr>
              <th className="py-2.5 px-3">ERP Code</th>
              <th className="py-2.5 px-3">Source Name</th>
              <th className="py-2.5 px-3">Assigned to ZMCCs</th>
              <th className="py-2.5 px-3">Status</th>
              <th className="py-2.5 px-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((source) => {
              const activeVis = source.zmcc_visibilities.filter((v) => v.is_active);
              return (
                <tr key={source.id} className="hover:bg-subtle transition-colors">
                  <td className="py-2.5 px-3 font-mono font-bold text-slate-900">{source.erp_code}</td>
                  <td className="py-2.5 px-3 font-semibold text-slate-800">{source.name}</td>
                  <td className="py-2.5 px-3">
                    <div className="flex flex-wrap gap-1">
                      {activeVis.length === 0 ? (
                        <span className="text-slate-400 text-[11px]">Not assigned to any ZMCC</span>
                      ) : (
                        activeVis.map((v) => {
                          const isContractor = v.source_type === 'CONTRACTOR';
                          return (
                            <span
                              key={v.zmcc_id}
                              className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border ${
                                isContractor
                                  ? 'bg-amber-50 text-amber-900 border-amber-200'
                                  : 'bg-slate-100 text-slate-800 border-border'
                              }`}
                            >
                              [{v.zmcc_code}] {v.zmcc_name}
                            </span>
                          );
                        })
                      )}
                    </div>
                  </td>
                  <td className="py-2.5 px-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        source.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {source.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <button
                      type="button"
                      aria-label={`Edit ${source.name}`}
                      onClick={() => openEdit(source)}
                      className="inline-flex min-h-11 min-w-11 items-center justify-center hover:bg-subtle text-slate-600 hover:text-primary rounded-lg transition"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-slate-400">
                  No milk sources found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pager page={Math.min(page, totalPages)} totalPages={totalPages} total={filtered.length} onPageChange={setPage} />

      {drawerOpen && (
        <Drawer open onOpenChange={(o) => !o && setDrawerOpen(false)}>
          <DrawerContent>
            <div className="space-y-4 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5">
              <DrawerTitle className="sr-only">{editing ? 'Edit Milk Source' : 'Create Milk Source'}</DrawerTitle>
              <div className="flex items-center justify-between pb-3 border-b border-border">
                <h3 className="text-sm font-semibold text-foreground">
                  {editing ? 'Edit Milk Source' : 'Create Milk Source'}
                </h3>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => setDrawerOpen(false)}
                  className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSave} className="space-y-3 text-xs">
                <div>
                  <label className="block font-semibold text-foreground mb-1">
                    ERP Code <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={form.erp_code}
                    onChange={(e) => setForm((prev) => ({ ...prev, erp_code: e.target.value }))}
                    placeholder="e.g. 1042"
                    className="w-full min-h-11 px-3 py-2 border border-border rounded-xl font-semibold bg-white"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-foreground mb-1">
                    Source Name <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g. Bhalwal Dairy Hub"
                    className="w-full min-h-11 px-3 py-2 border border-border rounded-xl font-semibold bg-white"
                  />
                </div>

                {editing && (
                  <div>
                    <label className="flex min-h-11 items-center space-x-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.is_active}
                        onChange={(e) => setForm((prev) => ({ ...prev, is_active: e.target.checked }))}
                        className="w-4 h-4 rounded text-primary focus:ring-primary"
                      />
                      <span className="font-semibold text-slate-700">Source Active Status</span>
                    </label>
                  </div>
                )}

                <div>
                  <label className="block font-semibold text-foreground mb-1">Assigned ZMCCs</label>
                  <div className="max-h-36 overflow-y-auto border border-border rounded-xl p-2.5 space-y-1 bg-subtle">
                    {zmccOptions.map((z) => (
                      <label key={z.id} className="flex min-h-11 items-center space-x-2 cursor-pointer text-xs">
                        <input
                          type="checkbox"
                          checked={form.zmcc_ids.includes(z.id)}
                          onChange={() => toggleZmcc(z.id)}
                          className="w-4 h-4 rounded text-primary focus:ring-primary"
                        />
                        <span className="text-slate-800">
                          [{z.code}] {z.name}
                        </span>
                      </label>
                    ))}
                    {zmccOptions.length === 0 && <span className="text-slate-400 text-xs">No ZMCCs loaded.</span>}
                  </div>
                </div>

                <div className="flex justify-end space-x-2 pt-3 border-t border-border">
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(false)}
                    className="min-h-11 px-4 py-2 border border-border rounded-xl text-slate-600 font-semibold hover:bg-subtle"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="min-h-11 px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-xl font-semibold transition disabled:opacity-50"
                  >
                    {submitting ? 'Saving…' : 'Save Milk Source'}
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
