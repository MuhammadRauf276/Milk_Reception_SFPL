'use client';

import { typePakistaniCnic, typePakistaniMobile } from '@/lib/pakistani-identity';
import React from 'react';
import { Combobox } from '@/components/ui/combobox';
import { InfoTip } from '@/components/ui/info-tip';
import { RouteMultiSelect } from '@/components/ui/route-multi-select';
import type { MasterFormProps } from './masterFormProps';

export const OperationalRecordForms: React.FC<MasterFormProps> = ({
  modalType,
  formData,
  setFormData,
  activeRecord,
  helperRoutes,
  helperAreas,
  helperChillers,
}) => (
  <>
              {/* Shop Details Form */}
              {(modalType === 'CREATE_SHOP' || modalType === 'EDIT_SHOP') && (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-secondary-foreground mb-1">Shop name</label>
                      <input
                        type="text"
                        required
                        value={formData.shop_name || ''}
                        onChange={(e) => setFormData({ ...formData, shop_name: e.target.value })}
                        placeholder="e.g. Al-Madina Milk Point"
                        className="w-full min-h-11 px-3 py-2 border border-border rounded-xl text-sm font-semibold focus:ring-2 focus:ring-primary"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-secondary-foreground mb-1">
                        Shop Owner / Contractor
                      </label>
                      <input
                        type="text"
                        required
                        value={formData.owner_name || ''}
                        onChange={(e) => setFormData({ ...formData, owner_name: e.target.value })}
                        placeholder="e.g. Owner Full Name"
                        className="w-full min-h-11 px-3 py-2 border border-border rounded-xl text-sm font-semibold focus:ring-2 focus:ring-primary"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-secondary-foreground mb-1">Phone number</label>
                      <input
                        type="text"
                        required
                        value={formData.phone_number || ''}
                        onChange={(e) => setFormData({ ...formData, phone_number: typePakistaniMobile(e.target.value) })}
                        placeholder="0300-1234567"
                        className="w-full min-h-11 px-3 py-2 border border-border rounded-xl text-sm tabular-nums font-semibold focus:ring-2 focus:ring-primary"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-secondary-foreground mb-1">CNIC (13 Digits)</label>
                      <input
                        type="text"
                        required
                        value={formData.cnic || ''}
                        onChange={(e) => setFormData({ ...formData, cnic: typePakistaniCnic(e.target.value) })}
                        placeholder="35201-1234567-1"
                        className="w-full min-h-11 px-3 py-2 border border-border rounded-xl text-sm tabular-nums font-semibold focus:ring-2 focus:ring-primary"
                      />
                    </div>
                  </div>

                  {/* Dependent Route & Area Selection */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-secondary-foreground mb-1">Home route</label>
                      <Combobox
                        options={helperRoutes.map((r) => ({ value: r.id, label: `${r.name} · ${r.route_code}`, keywords: r.route_code }))}
                        value={String(formData.route_id || '')}
                        onValueChange={(v) => setFormData({ ...formData, route_id: v, area_id: '', extra_route_ids: (formData.extra_route_ids ?? []).filter((id) => id !== v) })}
                        placeholder="Select route"
                        searchPlaceholder="Search route"
                        className="min-h-11 w-full text-xs font-semibold"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-secondary-foreground mb-1">Collection area</label>
                      <Combobox
                        options={helperAreas
                          .filter((a) => !formData.route_id || a.route_id === formData.route_id)
                          .map((a) => ({ value: a.id, label: `${a.name} · ${a.area_code}`, keywords: a.area_code }))}
                        value={String(formData.area_id || '')}
                        onValueChange={(v) => {
                          const selectedArea = helperAreas.find((a) => a.id === v);
                          setFormData({ ...formData, area_id: v, route_id: selectedArea ? selectedArea.route_id : formData.route_id });
                        }}
                        placeholder="Select area"
                        searchPlaceholder="Search area"
                        className="min-h-11 w-full text-xs font-semibold"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 flex items-center gap-1 text-xs font-semibold text-secondary-foreground">
                      Also on routes
                      <InfoTip label="About routes" text="The shop also shows on each ticked route. Collections count on the route driven." />
                    </label>
                    <RouteMultiSelect
                      routes={helperRoutes}
                      homeRouteId={String(formData.route_id || '')}
                      value={formData.extra_route_ids ?? []}
                      onChange={(ids) => setFormData({ ...formData, extra_route_ids: ids })}
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-secondary-foreground mb-1">Chiller ownership</label>
                      <Combobox
                        options={helperChillers.map((co) => ({ value: co.id, label: co.name }))}
                        value={String(formData.chiller_ownership_id || '')}
                        onValueChange={(v) => setFormData({ ...formData, chiller_ownership_id: v })}
                        placeholder="Select chiller ownership"
                        searchPlaceholder="Search chiller ownership"
                        className="min-h-11 w-full text-xs font-semibold"
                      />
                    </div>
                  </div>

                  {/* GPS Optional Coordinates */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-border">
                    <div>
                      <label className="block text-xs font-semibold text-secondary-foreground mb-1">
                        Latitude <span className="text-xs text-muted-foreground font-normal">(-90 to 90)</span>
                      </label>
                      <input
                        type="number"
                        step="any"
                        value={formData.latitude ?? ''}
                        onChange={(e) => setFormData({ ...formData, latitude: e.target.value })}
                        placeholder="31.2681"
                        className="w-full min-h-11 px-3 py-2 border border-border rounded-xl text-sm tabular-nums font-semibold focus:ring-2 focus:ring-primary"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-secondary-foreground mb-1">
                        Longitude <span className="text-xs text-muted-foreground font-normal">(-180 to 180)</span>
                      </label>
                      <input
                        type="number"
                        step="any"
                        value={formData.longitude ?? ''}
                        onChange={(e) => setFormData({ ...formData, longitude: e.target.value })}
                        placeholder="72.3181"
                        className="w-full min-h-11 px-3 py-2 border border-border rounded-xl text-sm tabular-nums font-semibold focus:ring-2 focus:ring-primary"
                      />
                    </div>
                  </div>
                  <InfoTip text="Enter both latitude and longitude, or neither." />
                </div>
              )}

              {/* Tank Form */}
              {(modalType === 'CREATE_TANK' || modalType === 'EDIT_TANK') && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-secondary-foreground mb-1">Tank Code *</label>
                    <input
                      type="text"
                      required
                      value={formData.tank_code || ''}
                      onChange={(e) => setFormData({ ...formData, tank_code: e.target.value.toUpperCase() })}
                      placeholder="e.g. TANK-01"
                      className="w-full min-h-11 px-3 py-2 border border-border rounded-xl text-sm tabular-nums font-semibold focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-secondary-foreground mb-1">Tank Name *</label>
                    <input
                      type="text"
                      required
                      value={formData.tank_name || ''}
                      onChange={(e) => setFormData({ ...formData, tank_name: e.target.value })}
                      placeholder="e.g. Raw Milk Tank 1"
                      className="w-full min-h-11 px-3 py-2 border border-border rounded-xl text-sm font-semibold focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-secondary-foreground mb-1">Total Capacity (Liters) *</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      required
                      value={formData.capacity_liters ?? ''}
                      onChange={(e) => setFormData({ ...formData, capacity_liters: e.target.value })}
                      placeholder="e.g. 5000"
                      className="w-full min-h-11 px-3 py-2 border border-border rounded-xl text-sm tabular-nums font-semibold focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </div>
              )}

              {/* Toggle Active Confirmation */}
              {modalType === 'TOGGLE_ACTIVE' && (
                <div className="space-y-3 py-2">
                  <p className="text-xs text-secondary-foreground font-medium">
                    Are you sure you want to {activeRecord?.is_active ? 'deactivate' : 'activate'}{' '}
                    <strong className="text-foreground font-semibold">
                      {activeRecord?.name || activeRecord?.shop_name || activeRecord?.tank_name}
                    </strong>
                    ?
                  </p>
                  {activeRecord?.is_active ? (
                    <div className="bg-card border-border p-3 border rounded-xl text-xs text-amber-800 font-medium">
                      Deactivating removes it from selection.
                      <InfoTip text="If active dependent records exist, deactivation will be blocked." />
                    </div>
                  ) : (
                    <div className="bg-card border-border p-3 border rounded-xl text-xs text-blue-800 font-medium">
                      Activating returns it to selection.
                      <InfoTip text="Requires all parent entities to be active." />
                    </div>
                  )}
                </div>
              )}
  </>
);
