export type CanonicalRole =
  | 'SUPER_ADMIN'
  | 'EXECUTIVE_MANAGEMENT'
  | 'DATA_EXECUTIVE'
  | 'HEAD_OF_MPD'
  | 'ADMIN_HEAD'
  | 'QA_HEAD'
  | 'PRODUCTION_HEAD'
  | 'FINANCE_ACCOUNTS'
  | 'ZMCC_MANAGER'
  | 'CONTRACTOR_MANAGER'
  | 'PHE_OPERATOR'
  | 'ZMCC_LAB_ATTENDANT'
  | 'MOT'
  | 'CONTRACTOR_OPERATOR'
  | 'SECURITY_OPERATOR'
  | 'QA_MANAGER'
  | 'QA_LAB_ATTENDANT'
  | 'WEIGHBRIDGE_OPERATOR'
  | 'PRODUCTION_RECEPTION_OPERATOR';

export type LegacyRole =
  | 'MPD_Operator'
  | 'MPD_Zone_Manager'
  | 'Security_Operator'
  | 'Security_Manager'
  | 'QA_Operator'
  | 'QA_Manager'
  | 'Weighbridge_Operator'
  | 'Production_Operator'
  | 'Production_Manager'
  | 'General_Plant_Manager'
  | 'Correction_Officer'
  | 'Admin'
  | 'MPD'
  | 'QA'
  | 'Security_Weight'
  | 'Production'
  | 'Management';

export type Role = CanonicalRole | LegacyRole;

export interface User {
  id: string;
  username: string;
  name: string;
  role: Role;
  department: string;
  zone?: string | null; // For ZMCC Zone Managers
  scope_type?: string;
  procurement_source_id?: string | null;
  procurement_source?: {
    id: string;
    code: string;
    name: string;
    source_type: string;
    is_active?: boolean;
  } | null;
  last_login_at?: string | null;
}

export const FIXTURE_USER_PROFILES: Record<string, User> = {
  'admin.superuser': {
    id: 'usr_admin_superuser',
    username: 'admin.superuser',
    name: 'Super Admin',
    role: 'SUPER_ADMIN',
    department: 'System Administration',
    scope_type: 'SYSTEM',
  },
  'super.admin': {
    id: 'usr_super_admin',
    username: 'super.admin',
    name: 'Retired Bootstrap Admin',
    role: 'SUPER_ADMIN',
    department: 'Retired Migration Account',
    scope_type: 'SYSTEM',
  },
  'executive.management': {
    id: 'usr_exec_mgmt',
    username: 'executive.management',
    name: 'Senior Executive Management',
    role: 'EXECUTIVE_MANAGEMENT',
    department: 'Executive Management',
    scope_type: 'SYSTEM',
  },
  'data.executive': {
    id: 'usr_data_exec',
    username: 'data.executive',
    name: 'Data Executive',
    role: 'DATA_EXECUTIVE',
    department: 'Data & Analytics',
    scope_type: 'SYSTEM',
  },
  'mpd.head': {
    id: 'usr_mpd_head',
    username: 'mpd.head',
    name: 'MPD Head',
    role: 'HEAD_OF_MPD',
    department: 'Milk Procurement',
    scope_type: 'SYSTEM',
  },
  'admin.head': {
    id: 'usr_admin_head',
    username: 'admin.head',
    name: 'Admin Head',
    role: 'ADMIN_HEAD',
    department: 'Administration',
    scope_type: 'DEPARTMENT',
  },
  'qa.head': {
    id: 'usr_qa_head',
    username: 'qa.head',
    name: 'QA Head',
    role: 'QA_HEAD',
    department: 'Quality Assurance',
    scope_type: 'DEPARTMENT',
  },
  'production.head': {
    id: 'usr_prod_head',
    username: 'production.head',
    name: 'Production Head',
    role: 'PRODUCTION_HEAD',
    department: 'Production',
    scope_type: 'DEPARTMENT',
  },
  'finance.accounts': {
    id: 'usr_fin_accts',
    username: 'finance.accounts',
    name: 'Finance and Accounts',
    role: 'FINANCE_ACCOUNTS',
    department: 'Finance & Accounts',
    scope_type: 'DEPARTMENT',
  },
  'zmcc.manager.north': {
    id: 'usr_mpd_zm_n',
    username: 'zmcc.manager.north',
    name: 'ZMCC Manager - Hasilpur',
    role: 'ZMCC_MANAGER',
    department: 'Milk Procurement',
    scope_type: 'SOURCE',
    zone: 'ZMCC Hasilpur',
  },
  'contractor.manager.alkhair': {
    id: 'usr_cont_mgr_ak',
    username: 'contractor.manager.alkhair',
    name: 'Contractor Manager - Al Khair',
    role: 'CONTRACTOR_MANAGER',
    department: 'Milk Procurement',
    scope_type: 'SOURCE',
    zone: 'Al Khair',
    procurement_source: {
      id: 'src_cont_alkhair',
      code: 'CONT-ALKHAIR',
      name: 'Al Khair Contractor',
      source_type: 'CONTRACTOR',
    },
  },
  'phe.operator': {
    id: 'usr_phe_op',
    username: 'phe.operator',
    name: 'PHE Operator',
    role: 'PHE_OPERATOR',
    department: 'Milk Procurement',
    scope_type: 'SOURCE',
    zone: 'ZMCC Hasilpur',
    procurement_source: {
      id: 'src_zmcc_hasilpur',
      code: 'ZMCC-HASILPUR',
      name: 'ZMCC Hasilpur',
      source_type: 'ZMCC',
    },
  },
  'zmcc.operator': {
    id: 'usr_mpd_op',
    username: 'zmcc.operator',
    name: 'ZMCC Lab Attendant',
    role: 'ZMCC_LAB_ATTENDANT',
    department: 'Milk Procurement',
    scope_type: 'SOURCE',
    zone: 'ZMCC Hasilpur',
    procurement_source: {
      id: 'src_zmcc_hasilpur',
      code: 'ZMCC-HASILPUR',
      name: 'ZMCC Hasilpur',
      source_type: 'ZMCC',
    },
  },
  'mot.driver': {
    id: 'usr_mot_driver',
    username: 'mot.driver',
    name: 'MOT Operator',
    role: 'MOT',
    department: 'Milk Procurement',
    scope_type: 'SOURCE',
    zone: 'ZMCC Hasilpur',
    procurement_source: {
      id: 'src_zmcc_hasilpur',
      code: 'ZMCC-HASILPUR',
      name: 'ZMCC Hasilpur',
      source_type: 'ZMCC',
    },
  },
  'contractor.operator.alkhair': {
    id: 'usr_cont_op_ak',
    username: 'contractor.operator.alkhair',
    name: 'Wasim Sahib',
    role: 'CONTRACTOR_OPERATOR',
    department: 'Milk Procurement - Contractor Operations',
    scope_type: 'SOURCE',
    zone: 'Al Khair',
    procurement_source: {
      id: 'src_cont_alkhair',
      code: 'CONT-ALKHAIR',
      name: 'Al Khair Contractor',
      source_type: 'CONTRACTOR',
    },
  },
  'security.gate': {
    id: 'usr_sec_op',
    username: 'security.gate',
    name: 'Security Operator',
    role: 'SECURITY_OPERATOR',
    department: 'Security',
    scope_type: 'DEPARTMENT',
  },
  'qa.manager': {
    id: 'usr_qa_mgr',
    username: 'qa.manager',
    name: 'QA Manager',
    role: 'QA_MANAGER',
    department: 'Quality Assurance',
    scope_type: 'DEPARTMENT',
  },
  'qa.chemist': {
    id: 'usr_qa_op',
    username: 'qa.chemist',
    name: 'QA Lab Attendant',
    role: 'QA_LAB_ATTENDANT',
    department: 'Quality Assurance',
    scope_type: 'DEPARTMENT',
  },
  'weighbridge.operator': {
    id: 'usr_wb_op_1',
    username: 'weighbridge.operator',
    name: 'Weighbridge Operator',
    role: 'WEIGHBRIDGE_OPERATOR',
    department: 'Production & Weighbridge',
    scope_type: 'DEPARTMENT',
  },
  'weighbridge.02': {
    id: 'usr_wb_op_2',
    username: 'weighbridge.02',
    name: 'Weighbridge Shift Operator 2',
    role: 'WEIGHBRIDGE_OPERATOR',
    department: 'Production & Weighbridge',
    scope_type: 'DEPARTMENT',
  },
  'production.operator': {
    id: 'usr_prod_op',
    username: 'production.operator',
    name: 'Production Reception Operator',
    role: 'PRODUCTION_RECEPTION_OPERATOR',
    department: 'Production',
    scope_type: 'DEPARTMENT',
  },
};

export const AUTHENTICATED_USERS: Record<string, { user: User }> = {
  'admin.superuser': { user: FIXTURE_USER_PROFILES['admin.superuser'] },
  'super.admin': { user: FIXTURE_USER_PROFILES['super.admin'] },
  'executive.management': { user: FIXTURE_USER_PROFILES['executive.management'] },
  'data.executive': { user: FIXTURE_USER_PROFILES['data.executive'] },
  'mpd.head': { user: FIXTURE_USER_PROFILES['mpd.head'] },
  'admin.head': { user: FIXTURE_USER_PROFILES['admin.head'] },
  'qa.head': { user: FIXTURE_USER_PROFILES['qa.head'] },
  'production.head': { user: FIXTURE_USER_PROFILES['production.head'] },
  'finance.accounts': { user: FIXTURE_USER_PROFILES['finance.accounts'] },
  'zmcc.manager.north': { user: FIXTURE_USER_PROFILES['zmcc.manager.north'] },
  'contractor.manager.alkhair': { user: FIXTURE_USER_PROFILES['contractor.manager.alkhair'] },
  'phe.operator': { user: FIXTURE_USER_PROFILES['phe.operator'] },
  'zmcc.operator': { user: FIXTURE_USER_PROFILES['zmcc.operator'] },
  'mot.driver': { user: FIXTURE_USER_PROFILES['mot.driver'] },
  'contractor.operator.alkhair': { user: FIXTURE_USER_PROFILES['contractor.operator.alkhair'] },
  'security.gate': { user: FIXTURE_USER_PROFILES['security.gate'] },
  'qa.manager': { user: FIXTURE_USER_PROFILES['qa.manager'] },
  'qa.chemist': { user: FIXTURE_USER_PROFILES['qa.chemist'] },
  'weighbridge.operator': { user: FIXTURE_USER_PROFILES['weighbridge.operator'] },
  'weighbridge.02': { user: FIXTURE_USER_PROFILES['weighbridge.02'] },
  'production.operator': { user: FIXTURE_USER_PROFILES['production.operator'] },
};

export const DEFAULT_USERS: Record<string, User> = {
  SUPER_ADMIN: FIXTURE_USER_PROFILES['admin.superuser'],
  EXECUTIVE_MANAGEMENT: FIXTURE_USER_PROFILES['executive.management'],
  DATA_EXECUTIVE: FIXTURE_USER_PROFILES['data.executive'],
  HEAD_OF_MPD: FIXTURE_USER_PROFILES['mpd.head'],
  ADMIN_HEAD: FIXTURE_USER_PROFILES['admin.head'],
  QA_HEAD: FIXTURE_USER_PROFILES['qa.head'],
  PRODUCTION_HEAD: FIXTURE_USER_PROFILES['production.head'],
  FINANCE_ACCOUNTS: FIXTURE_USER_PROFILES['finance.accounts'],
  ZMCC_MANAGER: FIXTURE_USER_PROFILES['zmcc.manager.north'],
  CONTRACTOR_MANAGER: FIXTURE_USER_PROFILES['contractor.manager.alkhair'],
  PHE_OPERATOR: FIXTURE_USER_PROFILES['phe.operator'],
  ZMCC_LAB_ATTENDANT: FIXTURE_USER_PROFILES['zmcc.operator'],
  MOT: FIXTURE_USER_PROFILES['mot.driver'],
  CONTRACTOR_OPERATOR: FIXTURE_USER_PROFILES['contractor.operator.alkhair'],
  SECURITY_OPERATOR: FIXTURE_USER_PROFILES['security.gate'],
  QA_MANAGER: FIXTURE_USER_PROFILES['qa.manager'],
  QA_LAB_ATTENDANT: FIXTURE_USER_PROFILES['qa.chemist'],
  WEIGHBRIDGE_OPERATOR: FIXTURE_USER_PROFILES['weighbridge.operator'],
  PRODUCTION_RECEPTION_OPERATOR: FIXTURE_USER_PROFILES['production.operator'],
};

export type ProcessStatus = 
  | 'DISPATCHED'
  | 'TOKEN_ISSUED'
  | 'PLANT_QA'
  | 'READY_FOR_GROSS'
  | 'GROSS_WEIGHED'
  | 'READY_FOR_UNLOADING'
  | 'UNLOADING'
  | 'READY_FOR_TARE'
  | 'TARE_WEIGHED'
  | 'READY_FOR_GATE_EXIT'
  | 'COMPLETED'
  | string;

export const STAGES: ProcessStatus[] = [
  'DISPATCHED',
  'TOKEN_ISSUED',
  'PLANT_QA',
  'READY_FOR_GROSS',
  'GROSS_WEIGHED',
  'READY_FOR_UNLOADING',
  'UNLOADING',
  'READY_FOR_TARE',
  'TARE_WEIGHED',
  'READY_FOR_GATE_EXIT',
  'COMPLETED',
];

export interface MilkProcessLog {
  id: number;
  portion_id?: number | null;
  visit_number?: string | null;
  reception_number?: string | null;
  vehicle_number: string;
  portion_number: string;
  token_number?: string | null;
  zonal_contractor_name: string;
  status: ProcessStatus;

  // AUTHORITATIVE PLANT-EXIT BUSINESS DATE (FINALIZED ONLY UPON COMPLETE PLANT EXIT)
  business_date?: string | null;

  // MPD PHYSICAL RAW INPUTS
  dispatch_date?: string | null;
  dispatch_day?: string | null;
  dispatch_week?: number | null;
  dispatch_month?: string | null;
  dispatch_year?: number | null;
  zonal_contractor_dispatch_time?: string | null;
  dispatch_kg_gross?: number | null;
  dispatch_liters_gross?: number | null;
  vehicle_dispatch_quantity_value?: number | null;
  vehicle_dispatch_quantity_unit?: string | null;
  vehicle_dispatch_quantity_basis?: string | null;
  vehicle_dispatch_gross_liters?: number | null;
  dispatch_tests?: string | null;
  dispatch_fat?: number | null;
  dispatch_lr?: number | null;

  // QA PHYSICAL RAW INPUTS
  igp_date?: string | null;
  igp_time?: string | null;
  sampling_date?: string | null;
  sampling_time_start?: string | null;
  sampling_time_end?: string | null;
  sampling_tests?: string | null;
  sampling_lr?: number | null;
  sampling_fat?: number | null;
  b_mbrt_minutes_test?: number | null;
  calculated_status?: string | null;
  rejection_reasons?: string | null;
  remarks?: string | null;
  borderline_warning?: boolean | null;

  // PARALLEL LAB OVERRIDE CONTROL
  parallel_override_active?: boolean | null;
  parallel_override_code?: string | null;
  rm_mbrt_pending?: boolean | null;

  // SECURITY / WEIGHBRIDGE RAW INPUTS
  first_weight_time?: string | null;
  first_weight_of_vehicle?: number | null; // Gross Loaded Weight
  second_weight_time?: string | null;
  second_weight_of_vehicle?: number | null; // Tare Empty Weight
  out_from_gate_time?: string | null;

  // PRODUCTION RAW INPUTS
  reception_date?: string | null;
  reception_start_time?: string | null;
  reception_end_time?: string | null;
  silo_storage_id?: string | null;

  // DYNAMICALLY COMPUTED RUNTIME METRICS (NOT SAVED IN DB)
  computed_dispatch_snf?: number | null;
  computed_dispatch_ts?: number | null;
  computed_dispatch_13ts_liters?: number | null;
  computed_sampling_snf?: number | null;
  computed_sampling_ts?: number | null;
  computed_plant_liters?: number | null;
  computed_net_milk_weight?: number | null;
  computed_plant_13ts_liters?: number | null;

  // AUTHORITATIVE EVENT TIMESTAMPS (ISO INSTANTS)
  dispatch_timestamp?: string | null;
  gate_entry_timestamp?: string | null;
  gate_exit_timestamp?: string | null;
  first_weight_timestamp?: string | null;
  second_weight_timestamp?: string | null;
  unloading_start_timestamp?: string | null;
  unloading_end_timestamp?: string | null;

  // AUTHORITATIVE FINAL RECEIPT (SILO TRANSACTION EVIDENCE)
  final_receipt_exists?: boolean;
  final_receipt_transaction_id?: number | null;
  final_receipt_timestamp?: string | null;
  final_receipt_date?: string | null;
  reporting_date?: string | null;
  authoritative_final_liters?: number | null;

  // DYNAMIC CONFIGURED LAB RESULTS
  portion_lab_results?: PortionLabTestResult[];

  created_at: string;
  updated_at: string;
}

export interface PortionLabTestResult {
  test_id?: number | null;
  test_code: string;
  test_name: string;
  category?: string | null;
  result_type: 'NUMERIC' | 'QUALITATIVE' | 'OK_NOT_OK' | 'POSITIVE_NEGATIVE' | 'CALCULATED' | string;
  unit?: string | null;
  display_order?: number;
  is_active?: boolean;
  // Dispatch testing
  dispatch_performed: boolean;
  dispatch_value?: number | string | null;
  dispatch_numeric_value?: number | null;
  dispatch_text_value?: string | null;
  // Plant QA testing
  plant_performed: boolean;
  plant_value?: number | string | null;
  plant_numeric_value?: number | null;
  plant_text_value?: string | null;
  plant_status?: string | null;
  plant_is_passed?: boolean | null;
}

export interface DataAuditLog {
  id: number;
  log_id: number;
  modified_by_user: string;
  role: Role;
  column_name: string;
  original_value?: string | null;
  new_value?: string | null;
  action_type: 'UPDATE' | 'REVERT' | 'CORRECTION';
  timestamp: string;
}

export interface KanbanStageConfig {
  status: ProcessStatus;
  canonicalStatuses: string[];
  title: string;
  subtitle: string;
  iconType: string;
}

export const KANBAN_STAGES: KanbanStageConfig[] = [
  {
    status: 'DISPATCHED',
    canonicalStatuses: ['DISPATCHED'],
    title: 'En-Route / Dispatched',
    subtitle: 'On the road to plant',
    iconType: 'truck',
  },
  {
    status: 'TOKEN_ISSUED',
    canonicalStatuses: ['TOKEN_ISSUED'],
    title: 'Gate 2 Token Desk',
    subtitle: 'IGP & Security Entry',
    iconType: 'badge',
  },
  {
    status: 'PLANT_QA',
    canonicalStatuses: ['PLANT_QA'],
    title: 'QA Lab Sampling',
    subtitle: 'Chemical & MBRT Tests',
    iconType: 'flask',
  },
  {
    status: 'READY_FOR_GROSS',
    canonicalStatuses: ['READY_FOR_GROSS', 'GROSS_WEIGHED', 'READY_FOR_TARE', 'TARE_WEIGHED'],
    title: 'Weighbridge Scale',
    subtitle: 'Gross & Tare Weighing',
    iconType: 'scale',
  },
  {
    status: 'READY_FOR_UNLOADING',
    canonicalStatuses: ['READY_FOR_UNLOADING', 'UNLOADING'],
    title: 'Silo Milk Reception',
    subtitle: 'Unloading into Storage',
    iconType: 'tank',
  },
];

export interface StageDurations {
  waitingForSampling?: string;
  samplingDuration?: string;
  waitingForFirstWeight?: string;
  waitingForReception?: string;
  unloadingDuration?: string;
  totalGateToGateTime?: string;
}
