export interface ErpSourceItem {
  id: string;
  erp_code: string;
  name: string;
  is_active: boolean;
  created_at: string;
  zmcc_visibilities: Array<{
    zmcc_id: string;
    zmcc_code: string;
    zmcc_name: string;
    source_type?: string;
    is_active: boolean;
  }>;
}

export interface ContractorItem {
  id: string;
  code: string;
  name: string;
  erp_code: string | null;
  is_active: boolean;
}

export interface ZmccOption {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
}

export type SourceFeedback = { type: 'success' | 'error'; message: string } | null;
