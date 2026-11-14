import { resolveRoleHome } from './role-routing';

/**
 * Valid Next.js App Router paths that exist under src/app/.
 * Notification deep links are validated against this set so stale or malformed
 * paths stored in the database never route the user to a 404 page.
 */
export const VALID_APP_ROUTES: ReadonlySet<string> = new Set([
  '/',
  '/approvals',
  '/command',
  '/contractor/dispatch',
  '/contractor/manager',
  '/data-executive',
  '/department/production',
  '/department/production-head',
  '/department/qa',
  '/department/qa-head',
  '/department/security',
  '/department/weighbridge',
  '/device-setup',
  '/executive/live-vehicles',
  '/mot',
  '/mpd/zmcc-manager',
  '/my-requests',
  '/notifications/settings',
  '/phe',
  '/request-correction',
  '/sources',
  '/super-admin',
  '/super-admin/audit',
  '/super-admin/corrections',
  '/super-admin/daily-report',
  '/super-admin/devices',
  '/super-admin/fleet',
  '/super-admin/hierarchy-work',
  '/super-admin/lab-tests',
  '/super-admin/master-data',
  '/super-admin/mot-operations',
  '/super-admin/notification-devices',
  '/super-admin/operations',
  '/super-admin/photos',
  '/super-admin/procurement-sources',
  '/super-admin/qa-warnings',
  '/super-admin/reports',
  '/super-admin/settings',
  '/super-admin/silos',
  '/super-admin/sop-rules',
  '/super-admin/test-point-policies',
  '/super-admin/test-policies',
  '/super-admin/users',
  '/super-admin/weighing-policy',
  '/super-admin/whatsapp',
  '/super-admin/zmcc-master-data',
  '/super-admin/zmcc-tanks',
  '/tv-board',
  '/whatsapp-gateway',
  '/zmcc/dispatch',
  '/zmcc/lab',
]);

export interface ResolveNotificationLinkOptions {
  eventKey?: string | null;
  role?: string | null;
}

function defaultLinkForEvent(eventKey?: string | null, role?: string | null): string | null {
  switch (eventKey) {
    case 'MOT_RETURNING_TO_ZMCC':
      return role === 'ZMCC_MANAGER' ? '/mpd/zmcc-manager?tab=MOT_JOURNEYS' : '/phe';
    case 'MOT_VEHICLE_PROBLEM_PENDING':
      return '/mpd/zmcc-manager?tab=MOT_JOURNEYS';
    case 'MOT_SHOP_EXCEPTION_PENDING':
      return '/mpd/zmcc-manager?tab=APPROVALS&view=MOT_EXCEPTIONS';
    case 'MOT_SHOP_WARNING_LOGGED':
      return '/mpd/zmcc-manager?tab=OVERVIEW';
    case 'ZMCC_LAB_EXCEPTION_PENDING':
      return '/mpd/zmcc-manager?tab=APPROVALS&view=LAB_EXCEPTIONS';
    case 'ZMCC_LAB_WARNING_LOGGED':
      return '/mpd/zmcc-manager?tab=HISTORY&view=LAB_CORRECTIONS';
    case 'ZMCC_EXIT_WITHOUT_UNLOADING':
      return '/mpd/zmcc-manager?tab=OVERVIEW';
    case 'ZMCC_CLOSE_REQUEST_PENDING':
    case 'NEW_HC_PENDING':
    case 'NEW_ROUTE_PENDING':
      return '/mpd/zmcc-manager?tab=APPROVALS';
    case 'NEW_SHOP_PENDING':
      return role === 'MDO' ? '/phe?section=mot&view=approvals' : '/approvals';
    case 'DISPATCH_APPROVAL_PENDING':
      return role === 'CONTRACTOR_MANAGER' ? '/contractor/manager' : '/mpd/zmcc-manager?tab=APPROVALS';
    case 'PLANT_QA_EXCEPTION_PENDING':
    case 'PLANT_QA_WARNING_LOGGED':
      return '/department/qa-head';
    case 'HIGH_TRANSIT_LOSS_ALERT':
      return '/mpd/zmcc-manager?tab=PLANT_TRANSIT&view=RECONCILIATION';
    case 'CORRECTION_ESCALATED':
    case 'REJECTED_MILK_REMARKS_PENDING':
      return '/approvals';
    case 'FINANCE_TARGET_CHANGED':
      return '/super-admin/reports';
    case 'SELF_APPROVAL_REVIEW':
      return '/super-admin/audit';
    case 'SYSTEM_ALERT':
      return '/super-admin';
    default:
      return null;
  }
}

function normalizePath(raw: string): string {
  if (raw.length > 1 && raw.endsWith('/')) {
    return raw.slice(0, -1);
  }
  return raw;
}

/**
 * Resolves any notification `deepLink` into a safe, existing in-app route.
 * Automatically repairs known removed/legacy paths (e.g. `/control-center`, `/zmcc`,
 * `/finance/reconciliation`, `?tab=COLLECTIONS`) and falls back cleanly by `eventKey`
 * or `role` if a path does not exist.
 */
export function resolveNotificationDeepLink(
  rawLink: string | null | undefined,
  options: ResolveNotificationLinkOptions = {}
): string | null {
  const { eventKey, role } = options;

  const fallback = (): string | null => {
    const byEvent = defaultLinkForEvent(eventKey, role);
    if (byEvent) return byEvent;
    if (role) {
      const home = resolveRoleHome(role);
      if (!home.startsWith('/workspace-unavailable')) return home;
    }
    return null;
  };

  if (!rawLink || typeof rawLink !== 'string') {
    return fallback();
  }

  const trimmed = rawLink.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes('://')) {
    return fallback();
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed, 'http://localhost');
  } catch {
    return fallback();
  }

  const pathname = normalizePath(parsed.pathname);

  // Repair legacy / removed routes saved in existing DB notifications.
  if (pathname === '/control-center') {
    return '/super-admin/audit';
  }
  if (pathname === '/finance/reconciliation') {
    return '/super-admin/reports';
  }
  if (pathname === '/zmcc') {
    return defaultLinkForEvent(eventKey, role) ?? (role === 'ZMCC_MANAGER' ? '/mpd/zmcc-manager?tab=OVERVIEW' : '/phe');
  }
  if (pathname === '/mpd/zmcc-manager' && parsed.searchParams.get('tab') === 'COLLECTIONS') {
    parsed.searchParams.set('tab', 'OVERVIEW');
    return `${pathname}?${parsed.searchParams.toString()}`;
  }

  if (VALID_APP_ROUTES.has(pathname)) {
    const qs = parsed.searchParams.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  return fallback();
}
