export const CAPABILITIES = [
  'VIEW',
  'CREATE',
  'EDIT_DRAFT',
  'SUBMIT',
  'REQUEST_CORRECTION',
  'CORRECT',
  'APPROVE',
  'CLOSE',
  'POST',
  'ADMINISTER',
  'VIEW_AUDIT',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export const ALL_CAPABILITIES: ReadonlySet<Capability> = new Set(CAPABILITIES);

