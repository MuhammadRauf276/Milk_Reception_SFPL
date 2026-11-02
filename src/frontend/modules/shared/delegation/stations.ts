import React from 'react';
import type { CanonicalRole, User } from '@/backend/core/types';
import { canActAs, getAncestorRoles, getDescendantRoles, isCanonicalRole } from '@/backend/core/roles/hierarchy';
import { resolveRoleHome } from '@/lib/role-routing';
import type { RoleNavLeaf } from '../navigation/roleNavConfig';
import {
  Factory,
  FlaskConical,
  ClipboardList,
  Truck,
  Send,
  Building2,
  Scale,
  Database,
  ShieldCheck,
  Route as RouteIcon,
  LayoutDashboard,
} from 'lucide-react';

export type StationGroup = 'ZMCC Operations' | 'Contractor Operations' | 'Plant Operations';

export interface CanonicalStation {
  id: string;
  label: string;
  href: string;
  basePath: string;
  primaryRole: CanonicalRole;
  group: StationGroup;
  targetSourceType: 'ZMCC' | 'CONTRACTOR' | null;
  icon: React.ComponentType<{ className?: string }>;
  subordinateRoleLabel: string;
  plantFacilityName?: string;
}

/**
 * Single source of truth for canonical stations that can be operated or covered by team superiors.
 * Defined strictly according to §5.2 and §5.4.
 */
export const CANONICAL_STATIONS: readonly CanonicalStation[] = [
  // --- ZMCC Operations ---
  {
    id: 'zmcc-lab',
    label: 'Zonal Lab',
    href: '/zmcc/lab',
    basePath: '/zmcc/lab',
    primaryRole: 'ZMCC_LAB_ATTENDANT',
    subordinateRoleLabel: 'Zonal Lab Attendant',
    icon: FlaskConical,
    group: 'ZMCC Operations',
    targetSourceType: 'ZMCC',
  },
  {
    id: 'phe-arrivals',
    label: 'PHE Milk Reception',
    href: '/phe?section=arrivals',
    basePath: '/phe',
    primaryRole: 'PHE_OPERATOR',
    subordinateRoleLabel: 'PHE Operator',
    icon: ClipboardList,
    group: 'ZMCC Operations',
    targetSourceType: 'ZMCC',
  },
  {
    id: 'mot-collection',
    label: 'Mobile Tester Journey',
    href: '/mot',
    basePath: '/mot',
    primaryRole: 'MOT',
    subordinateRoleLabel: 'Mobile Tester',
    icon: Truck,
    group: 'ZMCC Operations',
    targetSourceType: 'ZMCC',
  },
  {
    id: 'zmcc-dispatch',
    label: 'Tanker Dispatch',
    href: '/zmcc/dispatch',
    basePath: '/zmcc/dispatch',
    primaryRole: 'ZMCC_LAB_ATTENDANT',
    subordinateRoleLabel: 'Zonal Lab Attendant',
    icon: Send,
    group: 'ZMCC Operations',
    targetSourceType: 'ZMCC',
  },
  {
    id: 'mdo-operations',
    label: 'MDO Field Operations',
    href: '/phe?section=mot&view=dispatch',
    basePath: '/phe',
    primaryRole: 'MDO',
    subordinateRoleLabel: 'MDO (Milk Development Officer)',
    icon: RouteIcon,
    group: 'ZMCC Operations',
    targetSourceType: 'ZMCC',
  },
  {
    id: 'zmcc-manager-workspace',
    label: 'ZMCC Manager',
    href: '/mpd/zmcc-manager?tab=OVERVIEW',
    basePath: '/mpd/zmcc-manager',
    primaryRole: 'ZMCC_MANAGER',
    subordinateRoleLabel: 'Zonal Manager',
    icon: LayoutDashboard,
    group: 'ZMCC Operations',
    targetSourceType: 'ZMCC',
  },

  // --- Contractor Operations ---
  {
    id: 'contractor-dispatch',
    label: 'Contractor Dispatch',
    href: '/contractor/dispatch',
    basePath: '/contractor/dispatch',
    primaryRole: 'CONTRACTOR_OPERATOR',
    subordinateRoleLabel: 'Contractor Operator',
    icon: Building2,
    group: 'Contractor Operations',
    targetSourceType: 'CONTRACTOR',
  },
  {
    id: 'contractor-manager-workspace',
    label: 'Contractor Manager',
    href: '/contractor/manager?tab=OVERVIEW',
    basePath: '/contractor/manager',
    primaryRole: 'CONTRACTOR_MANAGER',
    subordinateRoleLabel: 'Contractor Manager',
    icon: Building2,
    group: 'Contractor Operations',
    targetSourceType: 'CONTRACTOR',
  },

  // --- Plant Operations ---
  {
    id: 'weighbridge',
    label: 'Weighbridge',
    href: '/department/weighbridge',
    basePath: '/department/weighbridge',
    primaryRole: 'WEIGHBRIDGE_OPERATOR',
    subordinateRoleLabel: 'Weighbridge Operator',
    icon: Scale,
    group: 'Plant Operations',
    targetSourceType: null,
    plantFacilityName: 'Production & Weighbridge',
  },
  {
    id: 'silo-unloading',
    label: 'Silo Unloading',
    href: '/department/production',
    basePath: '/department/production',
    primaryRole: 'PRODUCTION_RECEPTION_OPERATOR',
    subordinateRoleLabel: 'Production Reception Operator',
    icon: Database,
    group: 'Plant Operations',
    targetSourceType: null,
    plantFacilityName: 'Plant Silo Reception',
  },
  {
    id: 'production-head-workspace',
    label: 'Production Head',
    href: '/department/production-head',
    basePath: '/department/production-head',
    primaryRole: 'PRODUCTION_HEAD',
    subordinateRoleLabel: 'Production Head',
    icon: Factory,
    group: 'Plant Operations',
    targetSourceType: null,
    plantFacilityName: 'Production & Weighbridge',
  },
  {
    id: 'plant-qa',
    label: 'Plant Reception Lab',
    href: '/department/qa',
    basePath: '/department/qa',
    primaryRole: 'QA_LAB_ATTENDANT',
    subordinateRoleLabel: 'QAE – Reception Lab',
    icon: FlaskConical,
    group: 'Plant Operations',
    targetSourceType: null,
    plantFacilityName: 'Quality Assurance',
  },
  {
    id: 'qa-head-workspace',
    label: 'AVP QA Quality',
    href: '/department/qa-head',
    basePath: '/department/qa-head',
    primaryRole: 'QA_HEAD',
    subordinateRoleLabel: 'AVP, Quality Assurance',
    icon: ShieldCheck,
    group: 'Plant Operations',
    targetSourceType: null,
    plantFacilityName: 'Quality Assurance',
  },
  {
    id: 'security-gate',
    label: 'Security Gate',
    href: '/department/security',
    basePath: '/department/security',
    primaryRole: 'SECURITY_OPERATOR',
    subordinateRoleLabel: 'Admin Operator',
    icon: ShieldCheck,
    group: 'Plant Operations',
    targetSourceType: null,
    plantFacilityName: 'Plant Main Gate',
  },
] as const;

/**
 * Finds the canonical station matching the current pathname and search params.
 */
export function getStationForRoute(
  pathname: string,
  searchParams?: { get: (key: string) => string | null } | null
): CanonicalStation | null {
  if (!pathname) return null;

  // Specific check for MDO on /phe: if view is approvals or section is mot
  if (pathname === '/phe') {
    const section = searchParams?.get('section');
    const view = searchParams?.get('view');
    if (view === 'approvals' || section === 'mot' || section === 'suppliers') {
      const mdoStation = CANONICAL_STATIONS.find((s) => s.id === 'mdo-operations');
      if (mdoStation) return mdoStation;
    }
    const pheStation = CANONICAL_STATIONS.find((s) => s.id === 'phe-arrivals');
    if (pheStation) return pheStation;
  }

  // Exact base path match
  const match = CANONICAL_STATIONS.find((s) => s.basePath === pathname);
  return match ?? null;
}

/**
 * Dynamically derives authorized subordinate stations for a user role.
 * Uses `getDescendantRoles(currentUser.role)` to ensure strict hierarchy compliance.
 *
 * For HEAD_OF_MPD and SUPER_ADMIN, leaves include `group` for logical grouping.
 * Preserves active source ID in href query parameters if provided.
 */
export function getTeamStationsForRole(
  role: string | null | undefined,
  currentSourceId?: string | null
): RoleNavLeaf[] {
  if (!role || !isCanonicalRole(role)) return [];

  const descendants = getDescendantRoles(role);
  if (descendants.length === 0) return [];

  const isWideGroupRole =
    role === 'HEAD_OF_MPD' || role === 'SUPER_ADMIN' || role === 'DATA_EXECUTIVE';

  // Group ordering
  const groupOrder: Record<StationGroup, number> = {
    'ZMCC Operations': 1,
    'Contractor Operations': 2,
    'Plant Operations': 3,
  };

  const eligibleStations = CANONICAL_STATIONS.filter((station) => {
    if (!descendants.includes(station.primaryRole)) return false;
    // MPD Head manages Milk Procurement (ZMCC & Contractor Operations), never Plant Operations
    if (role === 'HEAD_OF_MPD' && station.group === 'Plant Operations') return false;
    return true;
  });

  // Sort by group order then original order
  const sortedStations = [...eligibleStations].sort((a, b) => {
    const gDiff = groupOrder[a.group] - groupOrder[b.group];
    if (gDiff !== 0) return gDiff;
    return 0;
  });

  return sortedStations.map((station) => {
    let targetHref = station.href;
    if (currentSourceId && station.targetSourceType === 'ZMCC') {
      const hasQuery = targetHref.includes('?');
      targetHref = `${targetHref}${hasQuery ? '&' : '?'}zmccId=${encodeURIComponent(currentSourceId)}`;
    }

    return {
      id: `team-station-${station.id}`,
      label: station.label,
      href: targetHref,
      icon: station.icon,
      group: isWideGroupRole ? station.group : undefined,
    };
  });
}

export interface DelegationContextInfo {
  isDelegated: boolean;
  station: CanonicalStation | null;
  actingAs: CanonicalRole | null;
  subordinateRoleLabel: string;
  homeRoute: string;
  isRegional: boolean;
  targetSourceType: 'ZMCC' | 'CONTRACTOR' | null;
  defaultFacilityName?: string;
}

/**
 * Determines whether the user is operating in delegated mode (§5.6).
 *
 * Requirements:
 * 1. Target route belongs to an authorized descendant role (canActAs === true).
 * 2. Actor's primary role is higher than station's primary operator role.
 */
export function resolveDelegationContext(
  currentUser: User | null,
  pathname: string,
  searchParams?: { get: (key: string) => string | null } | null
): DelegationContextInfo {
  const defaultResult: DelegationContextInfo = {
    isDelegated: false,
    station: null,
    actingAs: null,
    subordinateRoleLabel: '',
    homeRoute: currentUser?.role ? resolveRoleHome(currentUser.role) : '/',
    isRegional: false,
    targetSourceType: null,
  };

  if (!currentUser?.role || !isCanonicalRole(currentUser.role)) {
    return defaultResult;
  }

  const station = getStationForRoute(pathname, searchParams);
  if (!station) {
    return defaultResult;
  }

  const actorRole = currentUser.role;
  const targetRole = station.primaryRole;

  // Condition 1: Can the actor act as targetRole?
  const isAuthorized = canActAs(actorRole, targetRole);
  if (!isAuthorized) {
    return defaultResult;
  }

  // Condition 2: Is the actor's primary role strictly higher than the station's primary operator role?
  // If the actor's own role equals targetRole, they are doing their own job, not delegated!
  const isActorHigher =
    actorRole !== targetRole &&
    (actorRole === 'SUPER_ADMIN' || getAncestorRoles(targetRole).includes(actorRole));

  if (!isActorHigher) {
    return defaultResult;
  }

  return {
    isDelegated: true,
    station,
    actingAs: targetRole,
    subordinateRoleLabel: station.subordinateRoleLabel,
    homeRoute: resolveRoleHome(actorRole),
    isRegional: station.targetSourceType !== null,
    targetSourceType: station.targetSourceType,
    defaultFacilityName: station.plantFacilityName,
  };
}
