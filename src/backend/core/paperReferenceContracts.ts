export type PaperReferenceKind =
  | 'SHOP_RMR'
  | 'LOCAL_SUPPLIER_RMR'
  | 'LEGACY_LOCAL_SUPPLIER_RMR'
  | 'RAW_MILK_TOKEN'
  | 'RAW_MILK_DISPATCH_NOTE'
  | 'PLANT_GATE_TOKEN';

export interface SystemRecordIdentity {
  entity: string;
  id: string;
  number?: string | null;
}

export interface PaperReferenceIdentity {
  type: PaperReferenceKind;
  value: string | null;
}

export interface PaperLinkedIdentityContract {
  system: SystemRecordIdentity;
  papers: PaperReferenceIdentity[];
}
