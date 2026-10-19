/**
 * Canonical Role-Based Escalation Matrix
 * Strictly role-based escalation lines without cross-departmental mixing.
 * STRICTLY ZERO personal names - official role titles only.
 */

export interface EscalationTier {
  role: string;
  roleTitle: string;
}

export interface DepartmentEscalationChain {
  department: string;
  stageName: string;
  tiers: EscalationTier[];
}

export const DEPARTMENT_ESCALATION_CHAINS: Record<string, DepartmentEscalationChain> = {
  PLANT_QA: {
    department: 'Plant QA Division',
    stageName: 'Plant QA Reception',
    tiers: [
      { role: 'QA_LAB_ATTENDANT', roleTitle: 'QAE, Reception Lab' },
      { role: 'QA_MANAGER', roleTitle: 'Manager, QA Reception Lab' },
      { role: 'QA_HEAD', roleTitle: 'AVP, QA Reception Lab' },
    ],
  },
  ZMCC_LAB: {
    department: 'Milk Procurement Division (Field & ZMCC)',
    stageName: 'ZMCC Intake Lab',
    tiers: [
      { role: 'ZMCC_LAB_ATTENDANT', roleTitle: 'ZMCC Lab Attendant' },
      { role: 'ZMCC_MANAGER', roleTitle: 'ZMCC Manager' },
      { role: 'HEAD_OF_MPD', roleTitle: 'MPD Head' },
    ],
  },
  ZMCC_PHE: {
    department: 'Milk Procurement Division (Field & ZMCC)',
    stageName: 'ZMCC Reception / Dispatch',
    tiers: [
      { role: 'PHE_OPERATOR', roleTitle: 'PHE Operator' },
      { role: 'ZMCC_MANAGER', roleTitle: 'ZMCC Manager' },
      { role: 'HEAD_OF_MPD', roleTitle: 'MPD Head' },
    ],
  },
  MOT_SHOP: {
    department: 'Milk Procurement Division (Field & ZMCC)',
    stageName: 'MOT Shop Collection',
    tiers: [
      { role: 'MOT', roleTitle: 'Mobile Tester (MOT)' },
      { role: 'ZMCC_MANAGER', roleTitle: 'ZMCC Manager' },
      { role: 'HEAD_OF_MPD', roleTitle: 'MPD Head' },
    ],
  },
  CONTRACTOR: {
    department: 'Milk Procurement Division (Field & ZMCC)',
    stageName: 'Contractor Operations',
    tiers: [
      { role: 'CONTRACTOR_OPERATOR', roleTitle: 'Contractor Operator' },
      { role: 'CONTRACTOR_MANAGER', roleTitle: 'Contractor Manager' },
      { role: 'HEAD_OF_MPD', roleTitle: 'MPD Head' },
    ],
  },
  PRODUCTION_WEIGHBRIDGE: {
    department: 'Plant Production Division',
    stageName: 'Plant Weighbridge',
    tiers: [
      { role: 'WEIGHBRIDGE_OPERATOR', roleTitle: 'Weighbridge Operator' },
      { role: 'PRODUCTION_HEAD', roleTitle: 'Production Head' },
    ],
  },
  PRODUCTION_SILOS: {
    department: 'Plant Production Division',
    stageName: 'Plant Silo Offloading',
    tiers: [
      { role: 'PRODUCTION_RECEPTION_OPERATOR', roleTitle: 'Production Reception Operator (Silos)' },
      { role: 'PRODUCTION_HEAD', roleTitle: 'Production Head' },
    ],
  },
};

export function getEscalationAuthority(originatingRole: string): {
  directDecision: EscalationTier | null;
  higherEscalation: EscalationTier | null;
} {
  for (const chain of Object.values(DEPARTMENT_ESCALATION_CHAINS)) {
    const idx = chain.tiers.findIndex((t) => t.role === originatingRole);
    if (idx !== -1) {
      const directDecision = chain.tiers[idx + 1] || null;
      const higherEscalation = chain.tiers[idx + 2] || null;
      return { directDecision, higherEscalation };
    }
  }
  return { directDecision: null, higherEscalation: null };
}
