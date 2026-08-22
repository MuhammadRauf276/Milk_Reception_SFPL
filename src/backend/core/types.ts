export type Role = 
  | 'SUPER_ADMIN'             // Canonical Super Admin: System configuration, access & audit
  | 'MPD_Operator'            // ZMCC/Contractor Operator: Enters initial dispatch
  | 'MPD_Zone_Manager'        // ZMCC Minor Manager: Views own zone, cross-verification analytics
  | 'ZMCC_MANAGER'            // ZMCC Source Manager: Restricted to assigned ZMCC
  | 'CONTRACTOR_MANAGER'      // Contractor Source Manager: Restricted to assigned Contractor
  | 'EXECUTIVE_MANAGEMENT'    // Executive / CEO / COO / Plant Head read-only analytics
  | 'Security_Operator'       // Security Operator: Tokens, Gate In, Gate Out
  | 'Security_Manager'        // Security Head: Audits security team & timestamps
  | 'QA_Operator'             // QA Lab Operator: Sampling, chemical tests, parallel override
  | 'QA_Manager'              // QA Big Manager: Read-only QA pipeline tracking
  | 'Weighbridge_Operator'    // Weighbridge Operator: 1st weight (gross) and 2nd weight (tare)
  | 'WEIGHBRIDGE_OPERATOR'    // Weighbridge Operator canonical role enum
  | 'Production_Operator'     // Production Operator: Silo assignment & unloading work
  | 'Production_Manager'      // Production Big Manager: Read-only silo reception & weighbridge tracking
  | 'General_Plant_Manager'   // Supreme Plant Manager: Full view across all departments
  | 'Correction_Officer'      // Dedicated Correction Officer: Only account allowed historical edits
  | 'Admin'                   // System Administrator legacy alias
  // Legacy aliases
  | 'MPD'
  | 'QA'
  | 'Security_Weight'
  | 'Production'
  | 'Management';

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
  'zmcc.operator': {
    id: 'usr_mpd_op',
    username: 'zmcc.operator',
    name: 'ZMCC Field Operator',
    role: 'MPD_Operator',
    department: 'Milk Procurement (MPD Field)'
  },
  'zmcc.manager.north': {
    id: 'usr_mpd_zm_n',
    username: 'zmcc.manager.north',
    name: 'ZMCC Minor Manager (Northern Zone)',
    role: 'MPD_Zone_Manager',
    department: 'Milk Procurement (Zone A)',
    zone: 'ZMCC Hasilpur'
  },
  'security.gate': {
    id: 'usr_sec_op',
    username: 'security.gate',
    name: 'Security Gate Operator',
    role: 'Security_Operator',
    department: 'Security & Weighbridge'
  },
  'security.head': {
    id: 'usr_sec_head',
    username: 'security.head',
    name: 'Security Admin Manager (Head)',
    role: 'Security_Manager',
    department: 'Security Management'
  },
  'qa.chemist': {
    id: 'usr_qa_op',
    username: 'qa.chemist',
    name: 'QA Lab Testing Chemist',
    role: 'QA_Operator',
    department: 'Quality Assurance Lab'
  },
  'qa.head': {
    id: 'usr_qa_head',
    username: 'qa.head',
    name: 'QA Department Manager',
    role: 'QA_Manager',
    department: 'QA Management'
  },
  'weighbridge.operator': {
    id: 'usr_wb_op_1',
    username: 'weighbridge.operator',
    name: 'Weighbridge Operator',
    role: 'WEIGHBRIDGE_OPERATOR',
    department: 'Production & Weighbridge'
  },
  'weighbridge.02': {
    id: 'usr_wb_op_2',
    username: 'weighbridge.02',
    name: 'Weighbridge Shift Operator 2',
    role: 'WEIGHBRIDGE_OPERATOR',
    department: 'Production & Weighbridge'
  },
  'production.operator': {
    id: 'usr_prod_op',
    username: 'production.operator',
    name: 'Production Operator',
    role: 'Production_Operator',
    department: 'Plant Production & Silos'
  },
  'production.head': {
    id: 'usr_prod_head',
    username: 'production.head',
    name: 'Production Department Manager',
    role: 'Production_Manager',
    department: 'Production Management'
  },
  'general.plant.manager': {
    id: 'usr_gpm',
    username: 'general.plant.manager',
    name: 'General Plant Manager',
    role: 'General_Plant_Manager',
    department: 'Plant Executive Directorate'
  },
  'correction.officer': {
    id: 'usr_corr_off',
    username: 'correction.officer',
    name: 'Dedicated Data Correction Officer',
    role: 'Correction_Officer',
    department: 'Plant Audit & Data Corrections'
  }
};

export const AUTHENTICATED_USERS: Record<string, { user: User }> = {
  'admin.superuser': { user: FIXTURE_USER_PROFILES['admin.superuser'] },
  'super.admin': { user: FIXTURE_USER_PROFILES['super.admin'] },
  'zmcc.operator': { user: FIXTURE_USER_PROFILES['zmcc.operator'] },
  'zmcc.manager.north': { user: FIXTURE_USER_PROFILES['zmcc.manager.north'] },
  'security.gate': { user: FIXTURE_USER_PROFILES['security.gate'] },
  'security.head': { user: FIXTURE_USER_PROFILES['security.head'] },
  'qa.chemist': { user: FIXTURE_USER_PROFILES['qa.chemist'] },
  'qa.head': { user: FIXTURE_USER_PROFILES['qa.head'] },
  'weighbridge.operator': { user: FIXTURE_USER_PROFILES['weighbridge.operator'] },
  'weighbridge.02': { user: FIXTURE_USER_PROFILES['weighbridge.02'] },
  'production.operator': { user: FIXTURE_USER_PROFILES['production.operator'] },
  'production.head': { user: FIXTURE_USER_PROFILES['production.head'] },
  'general.plant.manager': { user: FIXTURE_USER_PROFILES['general.plant.manager'] },
  'correction.officer': { user: FIXTURE_USER_PROFILES['correction.officer'] },
};

export const DEFAULT_USERS: Record<string, User> = {
  SUPER_ADMIN: FIXTURE_USER_PROFILES['admin.superuser'],
  MPD_Operator: FIXTURE_USER_PROFILES['zmcc.operator'],
  MPD_Zone_Manager: FIXTURE_USER_PROFILES['zmcc.manager.north'],
  Security_Operator: FIXTURE_USER_PROFILES['security.gate'],
  Security_Manager: FIXTURE_USER_PROFILES['security.head'],
  QA_Operator: FIXTURE_USER_PROFILES['qa.chemist'],
  QA_Manager: FIXTURE_USER_PROFILES['qa.head'],
  Production_Operator: FIXTURE_USER_PROFILES['production.operator'],
  Production_Manager: FIXTURE_USER_PROFILES['production.head'],
  General_Plant_Manager: FIXTURE_USER_PROFILES['general.plant.manager'],
  Correction_Officer: FIXTURE_USER_PROFILES['correction.officer'],
  Admin: FIXTURE_USER_PROFILES['admin.superuser'],
  // Legacy aliases
  MPD: FIXTURE_USER_PROFILES['zmcc.operator'],
  QA: FIXTURE_USER_PROFILES['qa.chemist'],
  Security_Weight: FIXTURE_USER_PROFILES['security.gate'],
  Production: FIXTURE_USER_PROFILES['production.operator'],
  Management: FIXTURE_USER_PROFILES['general.plant.manager'],
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
  // Legacy aliases for backward compatibility
  | 'Dispatched' 
  | 'Token Issued' 
  | 'Sampling' 
  | 'Sampling_In_Progress' 
  | 'First Weight' 
  | 'Silo Reception' 
  | 'Second Weight'
  | 'Completed'
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

  // MPD PHYSICAL RAW INPUTS
  dispatch_date?: string | null;
  dispatch_day?: string | null;
  dispatch_week?: number | null;
  dispatch_month?: string | null;
  dispatch_year?: number | null;
  zonal_contractor_dispatch_time?: string | null;
  scheduled_arrival_time?: string | null;
  dispatch_kg_gross?: number | null;
  dispatch_liters_gross?: number | null;
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

  created_at: string;
  updated_at: string;
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

export const KANBAN_STAGES: { status: ProcessStatus; title: string; subtitle: string; iconType: string }[] = [
  { status: 'Dispatched', title: 'En-Route / Dispatched', subtitle: 'On the road to plant', iconType: 'truck' },
  { status: 'Token Issued', title: 'Gate 2 Token Desk', subtitle: 'IGP & Security Entry', iconType: 'badge' },
  { status: 'Sampling', title: 'QA Lab Sampling', subtitle: 'Chemical & MBRT Tests', iconType: 'flask' },
  { status: 'First Weight', title: 'Weighbridge Scale', subtitle: 'Gross & Tare Weighing', iconType: 'scale' },
  { status: 'Silo Reception', title: 'Silo Milk Reception', subtitle: 'Unloading into Storage', iconType: 'tank' },
];

export interface StageDurations {
  waitingForSampling?: string;
  samplingDuration?: string;
  waitingForFirstWeight?: string;
  waitingForReception?: string;
  unloadingDuration?: string;
  totalGateToGateTime?: string;
}
