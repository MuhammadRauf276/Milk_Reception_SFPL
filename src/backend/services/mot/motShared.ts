import { prisma } from '@core/db';
import { Prisma } from '@prisma/client';
import { getCurrentUser } from '@core/auth';
import { User, Role } from '@core/types';
import { getPakistanCalendarDate } from '@core/business-day';
import { validatePhone, validateCnic } from '../zmccMasterDataService';
import { computeCanonicalMilkMetrics, formatCollectionSmsMessage, MOT_CALCULATION_VERSION } from '@backend/utils/milkFormulas';
import { recomputeMotJourneySummaryTx, serializeMotJourneySummary } from '../motJourneySummaryService';
import { PaperReferenceService } from '@/backend/services/paperReferenceService';
import { PaperReferenceType } from '@prisma/client';

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

export type MotAction = 'READ' | 'WRITE_PROFILE' | 'WRITE_VEHICLE' | 'ASSIGN_DISPATCH' | 'CANCEL_JOURNEY' | 'READ_CURRENT_JOURNEY' | 'SUBMIT_COLLECTION' | 'UPLOAD_GPS' | 'READ_MAP' | 'READ_SMS_OUTBOX' | 'READ_COLLECTIONS' | 'CORRECT_COLLECTION';

export interface ServiceResult<T> { status: number; data?: T; error?: string; }
