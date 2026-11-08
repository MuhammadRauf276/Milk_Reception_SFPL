import { cn } from '@/lib/utils';

/**
 * Shows how much authority a role has. For display only: permissions are always
 * decided on the server, never from this badge.
 */
const TIERS = {
  station: { label: 'Station', className: 'bg-muted text-secondary-foreground' },
  manager: { label: 'Manager', className: 'bg-muted text-foreground' },
  head: { label: 'Head', className: 'bg-muted text-foreground' },
  admin: { label: 'Administrator', className: 'bg-accent text-accent-foreground' },
} as const;

type Tier = keyof typeof TIERS;

const ROLE_TIERS: Record<string, Tier> = {
  SUPER_ADMIN: 'admin',
  DATA_EXECUTIVE: 'admin',
  EXECUTIVE_MANAGEMENT: 'head',
  HEAD_OF_MPD: 'head',
  ADMIN_HEAD: 'head',
  QA_HEAD: 'head',
  PRODUCTION_HEAD: 'head',
  FINANCE_ACCOUNTS: 'head',
  ZMCC_MANAGER: 'manager',
  CONTRACTOR_MANAGER: 'manager',
  PHE_OPERATOR: 'station',
  MDO: 'station',
  ZMCC_LAB_ATTENDANT: 'station',
  MOT: 'station',
  CONTRACTOR_OPERATOR: 'station',
  SECURITY_OPERATOR: 'station',
  QA_LAB_ATTENDANT: 'station',
  WEIGHBRIDGE_OPERATOR: 'station',
  PRODUCTION_RECEPTION_OPERATOR: 'station',
};

export function AuthorityBadge({ role, className }: { role?: string | null; className?: string }) {
  const tier = role ? TIERS[ROLE_TIERS[role]] : undefined;
  if (!tier) return null;
  return <span className={cn('inline-flex rounded-md px-1.5 py-0.5 text-xs font-medium', tier.className, className)}>{tier.label}</span>;
}
