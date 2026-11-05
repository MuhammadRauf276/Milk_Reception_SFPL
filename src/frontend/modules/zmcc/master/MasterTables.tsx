'use client';

import React from 'react';
import { Milk, History } from 'lucide-react';
import { MasterTable, StatusPill, type MasterCol } from './MasterTable';
import type {
  AreaItem,
  ChillerOwnershipItem,
  LocalSupplierItem,
  MasterDataTab,
  MasterRecord,
  MilkSourceItem,
  RouteItem,
  ShopItem,
  TankItem,
} from './masterTypes';

interface Props {
  activeTab: MasterDataTab;
  canEdit: boolean;
  /** Milk sources: Add/Edit only for the source owner roles; everyone else sees names only. */
  canEditSources: boolean;
  canViewSourceErp: boolean;
  localSuppliers: LocalSupplierItem[];
  routes: RouteItem[];
  areas: AreaItem[];
  milkSources: MilkSourceItem[];
  chillerOwnerships: ChillerOwnershipItem[];
  shops: ShopItem[];
  tanks: TankItem[];
  onIntakeTank?: (tank: TankItem) => void;
  onViewLedger?: (tank: TankItem) => void;
  onEdit: (r: MasterRecord) => void;
  onToggle: (r: MasterRecord) => void;
}

const status = <T extends { is_active: boolean; approval_status?: string | null }>(): MasterCol<T> => ({
  header: 'Status',
  align: 'center',
  cell: (r) => <StatusPill active={r.is_active} approvalStatus={r.approval_status} />,
});

const supplierCols: MasterCol<LocalSupplierItem>[] = [
  { header: 'Supplier Code', tdClass: 'tabular-nums font-semibold text-primary', cell: (s) => s.local_supplier_code },
  { header: 'Supplier Name', tdClass: 'font-semibold text-foreground', cell: (s) => s.name },
  { header: 'Phone', tdClass: 'tabular-nums text-slate-600', cell: (s) => s.phone || '-' },
  { header: 'CNIC', tdClass: 'tabular-nums text-slate-600', cell: (s) => s.cnic || '-' },
  status<LocalSupplierItem>(),
];

const routeCols: MasterCol<RouteItem>[] = [
  { header: 'Route Code', tdClass: 'tabular-nums font-semibold text-foreground', cell: (r) => r.route_code },
  { header: 'Route Name', tdClass: 'font-semibold text-foreground', cell: (r) => r.name },
  { header: 'Origin', tdClass: 'text-slate-600', cell: (r) => r.origin },
  { header: 'Destination', tdClass: 'text-slate-600', cell: (r) => r.destination },
  { header: 'Areas', align: 'center', tdClass: 'font-semibold tabular-nums', cell: (r) => r.area_count || 0 },
  status<RouteItem>(),
];

const areaCols: MasterCol<AreaItem>[] = [
  { header: 'Area Code', tdClass: 'tabular-nums font-semibold text-foreground', cell: (a) => a.area_code },
  { header: 'Area Name', tdClass: 'font-semibold text-foreground', cell: (a) => a.name },
  {
    header: 'Route',
    tdClass: 'text-slate-600',
    cell: (a) => (
      <>
        {a.route.name} <span className="text-xs tabular-nums text-slate-400">({a.route.route_code})</span>
      </>
    ),
  },
  { header: 'Shops', align: 'center', tdClass: 'font-semibold tabular-nums', cell: (a) => a.shop_count || 0 },
  status<AreaItem>(),
];

const sourceNameCol: MasterCol<MilkSourceItem> = { header: 'Source Name', tdClass: 'font-semibold text-foreground', cell: (m) => m.name };
const sourceCols: MasterCol<MilkSourceItem>[] = [
  { header: 'ERP Code', tdClass: 'tabular-nums font-semibold text-foreground', cell: (m) => m.erp_code ?? '-' },
  sourceNameCol,
  status<MilkSourceItem>(),
];
const sourceNameOnlyCols: MasterCol<MilkSourceItem>[] = [sourceNameCol, status<MilkSourceItem>()];

const chillerCols: MasterCol<ChillerOwnershipItem>[] = [
  { header: 'Ownership Code', tdClass: 'tabular-nums font-semibold text-foreground', cell: (c) => c.ownership_code },
  { header: 'Owner / Brand Name', tdClass: 'font-semibold text-foreground', cell: (c) => c.name },
  { header: 'Shops Assigned', align: 'center', tdClass: 'font-semibold tabular-nums', cell: (c) => c.shop_count || 0 },
  status<ChillerOwnershipItem>(),
];

const shopCols: MasterCol<ShopItem>[] = [
  { header: 'Shop Code', tdClass: 'tabular-nums font-semibold text-foreground', cell: (s) => s.shop_code },
  { header: 'Shop Name', tdClass: 'font-semibold text-foreground', cell: (s) => s.shop_name },
  { header: 'Owner / Contractor', tdClass: 'font-medium text-slate-700', cell: (s) => s.owner_name },
  { header: 'Contact', tdClass: 'tabular-nums text-slate-600', cell: (s) => s.phone_number },
  { header: 'Area & Route', tdClass: 'text-slate-700', cell: (s) => s.area.name },
  { header: 'Chiller', tdClass: 'text-slate-700 font-medium', cell: (s) => s.chiller_ownership.name },
  status<ShopItem>(),
];

const tankCols: MasterCol<TankItem>[] = [
  { header: 'Tank Code', tdClass: 'tabular-nums font-semibold text-foreground', cell: (t) => t.tank_code },
  { header: 'Tank Name', tdClass: 'font-semibold text-foreground', cell: (t) => t.tank_name },
  { header: 'Capacity (L)', align: 'right', tdClass: 'tabular-nums font-semibold', cell: (t) => `${Number(t.capacity_liters).toFixed(2)} L` },
  { header: 'Current Stock (L)', align: 'right', tdClass: 'tabular-nums font-semibold text-blue-700', cell: (t) => `${Number(t.current_stock).toFixed(2)} L` },
  {
    header: 'Stock @13% TS (L)',
    align: 'right',
    tdClass: 'tabular-nums font-semibold text-primary',
    cell: (t) => t.current_commercial_stock_at_13ts !== null && t.current_commercial_stock_at_13ts !== undefined
      ? `${Number(t.current_commercial_stock_at_13ts).toFixed(2)} L`
      : '—',
  },
  { header: 'Available Capacity (L)', align: 'right', tdClass: 'tabular-nums font-semibold text-emerald-700', cell: (t) => `${Number(t.available_capacity).toFixed(2)} L` },
  status<TankItem>(),
];

export const MasterTables: React.FC<Props> = (p) => {
  const common = { canEdit: p.canEdit, onEdit: p.onEdit, onToggle: p.onToggle };
  switch (p.activeTab) {
    case 'LOCAL_SUPPLIERS':
      return <MasterTable {...common} cols={supplierCols} rows={p.localSuppliers} entity="HC Supplier" emptyText="No HC suppliers." />;
    case 'ROUTES':
      return <MasterTable {...common} cols={routeCols} rows={p.routes} entity="Route" emptyText="No routes." />;
    case 'AREAS':
      return <MasterTable {...common} cols={areaCols} rows={p.areas} entity="Area" emptyText="No areas." />;
    case 'MILK_SOURCES':
      return <MasterTable
          {...common}
          canEdit={p.canEditSources}
          cols={p.canViewSourceErp ? sourceCols : sourceNameOnlyCols}
          rows={p.milkSources}
          entity="Milk Source"
         
          emptyText={"No milk sources."}
        />;
    case 'CHILLER_OWNERSHIP':
      return <MasterTable {...common} cols={chillerCols} rows={p.chillerOwnerships} entity="Chiller Ownership" emptyText="No chillers." />;
    case 'SHOPS':
      return <MasterTable {...common} cols={shopCols} rows={p.shops} entity="Shop" emptyText="No shops." />;
    case 'TANKS':
      return (
        <MasterTable
          {...common}
          cols={tankCols}
          rows={p.tanks}
          entity="Tank"
          hideActionsWhenReadOnly
          emptyText="No tanks."
          renderExtraActions={(tank) => (
            <>
              {tank.is_active && p.onIntakeTank && (
                <button
                  type="button"
                  onClick={() => p.onIntakeTank!(tank)}
                  className="p-2 min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 transition"
                  title="Intake Milk Stock (@13% TS and Gross Liters)"
                  aria-label="Intake Milk Stock"
                >
                  <Milk className="w-3.5 h-3.5" />
                </button>
              )}
              {p.onViewLedger && (
                <button
                  type="button"
                  onClick={() => p.onViewLedger!(tank)}
                  className="p-2 min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg border border-border hover:bg-slate-100 text-slate-700 transition"
                  title="View Stock Ledger"
                  aria-label="View Stock Ledger"
                >
                  <History className="w-3.5 h-3.5" />
                </button>
              )}
            </>
          )}
        />
      );
    default:
      return null;
  }
};
