import { User, Role } from '@core/types';

export interface MotAuthContext {
  user: User;
  actorUserId: bigint;
  role: Role;
  isSuperAdmin: boolean;
  isZmccManager: boolean;
  isPheOperator: boolean;
  isMot: boolean;
  effectiveZmccId: bigint | null;
}

export type MotAction = 'READ' | 'WRITE_PROFILE' | 'WRITE_VEHICLE' | 'ASSIGN_DISPATCH' | 'CANCEL_JOURNEY' | 'READ_CURRENT_JOURNEY' | 'SUBMIT_COLLECTION' | 'UPLOAD_GPS' | 'READ_MAP' | 'READ_SMS_OUTBOX' | 'READ_COLLECTIONS' | 'CORRECT_COLLECTION' | 'RETURN_TO_PHE' | 'RESUME_COLLECTION';

export interface ServiceResult<T> { status: number; data?: T; error?: string; }
