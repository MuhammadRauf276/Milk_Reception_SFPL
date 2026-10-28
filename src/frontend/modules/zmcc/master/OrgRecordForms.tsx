'use client';

import React from 'react';
import { Combobox } from '@/components/ui/combobox';
import type { MasterFormProps } from './masterFormProps';

export const OrgRecordForms: React.FC<MasterFormProps> = ({ modalType, formData, setFormData, activeRecord, helperRoutes }) => (
  <>
              {/* HC Supplier Form */}
              {(modalType === 'CREATE_LOCAL_SUPPLIER' || modalType === 'EDIT_LOCAL_SUPPLIER') && (
                <div className="space-y-3">
                  {modalType === 'EDIT_LOCAL_SUPPLIER' && (
                    <div className="bg-card border-border p-3 rounded-xl border text-xs space-y-1">
                      <div className="flex justify-between">
                        <span className="font-semibold text-slate-500">Supplier Code:</span>
                        <span className="tabular-nums font-semibold text-primary">{activeRecord?.local_supplier_code}</span>
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Supplier Name *
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={150}
                      value={formData.name || ''}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g. Haji Muhammad Sharif"
                      className="w-full min-h-[44px] px-3 py-2 border border-border rounded-xl text-sm font-semibold focus:ring-2 focus:ring-primary"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Phone Number *
                      </label>
                      <input
                        type="text"
                        required
                        maxLength={50}
                        value={formData.phone || ''}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                        placeholder="03001234567"
                        className="w-full min-h-[44px] px-3 py-2 border border-border rounded-xl text-sm tabular-nums font-semibold focus:ring-2 focus:ring-primary"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        CNIC *
                      </label>
                      <input
                        type="text"
                        required
                        maxLength={50}
                        value={formData.cnic || ''}
                        onChange={(e) => setFormData({ ...formData, cnic: e.target.value })}
                        placeholder="35201-1234567-1"
                        className="w-full min-h-[44px] px-3 py-2 border border-border rounded-xl text-sm tabular-nums font-semibold focus:ring-2 focus:ring-primary"
                      />
                    </div>
                  </div>

                </div>
              )}

              {/* Route Form */}
              {(modalType === 'CREATE_ROUTE' || modalType === 'EDIT_ROUTE') && (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Route Name</label>
                    <input
                      type="text"
                      required
                      value={formData.name || ''}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g. Jhang North Route"
                      className="w-full min-h-[44px] px-3 py-2 border border-border rounded-xl text-sm font-semibold focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Origin</label>
                      <input
                        type="text"
                        required
                        value={formData.origin || ''}
                        onChange={(e) => setFormData({ ...formData, origin: e.target.value })}
                        placeholder="e.g. Jhang Center"
                        className="w-full min-h-[44px] px-3 py-2 border border-border rounded-xl text-sm font-semibold focus:ring-2 focus:ring-primary"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Destination</label>
                      <input
                        type="text"
                        required
                        value={formData.destination || ''}
                        onChange={(e) => setFormData({ ...formData, destination: e.target.value })}
                        placeholder="e.g. Shakarganj Main Plant"
                        className="w-full min-h-[44px] px-3 py-2 border border-border rounded-xl text-sm font-semibold focus:ring-2 focus:ring-primary"
                      />
                    </div>
                  </div>
                </>
              )}

              {/* Area Form */}
              {(modalType === 'CREATE_AREA' || modalType === 'EDIT_AREA') && (
                <>
                  {modalType === 'CREATE_AREA' && (
                    <>
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">Parent Route</label>
                        <Combobox
                          options={helperRoutes.map((r) => ({ value: r.id, label: `${r.name} · ${r.route_code}`, keywords: r.route_code }))}
                          value={String(formData.route_id || '')}
                          onValueChange={(v) => setFormData({ ...formData, route_id: v })}
                          placeholder="Select an active route"
                          searchPlaceholder="Search route"
                          className="min-h-[44px] w-full text-xs font-semibold"
                        />
                      </div>
                    </>
                  )}
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Area Name</label>
                    <input
                      type="text"
                      required
                      value={formData.name || ''}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g. Kot Lakhpat Sub-area"
                      className="w-full min-h-[44px] px-3 py-2 border border-border rounded-xl text-sm font-semibold focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </>
              )}

              {/* Milk Source Form */}
              {(modalType === 'CREATE_MILK_SOURCE' || modalType === 'EDIT_MILK_SOURCE') && (
                <>
                  {(
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">ERP Code</label>
                      <input
                        type="text"
                        required
                        value={formData.erp_code || ''}
                        onChange={(e) => setFormData({ ...formData, erp_code: e.target.value.toUpperCase() })}
                        placeholder="e.g. SRC-ERP-901"
                        className="w-full min-h-[44px] px-3 py-2 border border-border rounded-xl text-sm tabular-nums font-semibold uppercase focus:ring-2 focus:ring-primary"
                      />
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Source Name</label>
                    <input
                      type="text"
                      required
                      value={formData.name || ''}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g. Direct Farmer Collective A"
                      className="w-full min-h-[44px] px-3 py-2 border border-border rounded-xl text-sm font-semibold focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </>
              )}

              {/* Chiller Ownership Form */}
              {(modalType === 'CREATE_CHILLER' || modalType === 'EDIT_CHILLER') && (
                <>
                  {modalType === 'CREATE_CHILLER' && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Ownership Code</label>
                      <input
                        type="text"
                        required
                        value={formData.ownership_code || ''}
                        onChange={(e) => setFormData({ ...formData, ownership_code: e.target.value.toUpperCase() })}
                        placeholder="e.g. CHL-BRAND-01"
                        className="w-full min-h-[44px] px-3 py-2 border border-border rounded-xl text-sm tabular-nums font-semibold uppercase focus:ring-2 focus:ring-primary"
                      />
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Owner / Brand Name</label>
                    <input
                      type="text"
                      required
                      value={formData.name || ''}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g. Shakarganj"
                      className="w-full min-h-[44px] px-3 py-2 border border-border rounded-xl text-sm font-semibold focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </>
              )}
  </>
);
