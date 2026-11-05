/**
 * Unified Approval Inbox Service
 * Aggregates pending and decided exceptions and authorization requests across all 4 operational stages.
 * Applies segregation of duties checks, SLA calculations, and progressive disclosure payloads.
 */

import { prisma } from '@/backend/core/db';
import { Prisma } from '@prisma/client';
import type { CanonicalRole } from '@/backend/core/types';
import {
  canDecideApproval,
  type ApprovalType,
  type OperationalStage,
} from '@/backend/services/escalation/approvalMatrix';

export type SlaStatus = 'NORMAL' | 'WARNING' | 'BREACHED';

export interface TestValueSnapshot {
  code: string;
  name: string;
  value: string | number | null;
  min?: number | null;
  max?: number | null;
  pass?: boolean | null;
  outcome?: string | null;
}

export interface PhotoSnapshot {
  captureId: string;
  labTestId?: string | null;
  received?: boolean;
  testCode?: string | null;
  label?: string;
  url?: string;
}

export interface UnifiedApprovalDetails {
  entityTitle: string;
  sourceName: string;
  sourceType: 'ZMCC' | 'CONTRACTOR' | 'PLANT';
  vehicleNumber?: string | null;
  grossLiters?: number | null;
  testValues?: TestValueSnapshot[];
  photos?: PhotoSnapshot[];
  sealNumber?: string | null;
  plantSealNumberEntered?: string | null;
  sealMatch?: boolean | null;
  personDecision?: 'ACCEPT' | 'REJECT' | null;
  personRemarks?: string | null;
  formulaAudit?: {
    policyVersion?: number | null;
    formulaBounds?: string | null;
    capturedAt?: string | null;
    deviceId?: string | null;
    gpsCoordinates?: { latitude: number; longitude: number; accuracy?: number | null } | null;
  } | null;
  metadata?: Record<string, unknown>;
}

export interface UnifiedApprovalItem {
  id: string;
  stage: OperationalStage;
  approvalType: ApprovalType;
  referenceNumber: string;
  sourceId?: string | null;
  sourceName?: string | null;
  zmccId?: string | null;
  contractorId?: string | null;
  submittedBy: {
    id: string;
    name: string;
    role: string;
    performedAsRole: string | null;
    isDelegated: boolean;
  };
  submittedAt: string;
  waitingMinutes: number;
  slaStatus: SlaStatus;
  reasonChips: string[];
  canDecide: boolean;
  disabledReason: string | null;
  details: UnifiedApprovalDetails;
  version: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'RETURNED';
  decision?: {
    decidedBy: string;
    decidedAt: string;
    decidedAsRole?: string | null;
    verdict: 'OKAY' | 'NO';
    remarks?: string | null;
  } | null;
}

export interface InboxCounts {
  totalPending: number;
  stage1: number;
  stage2: number;
  stage3: number;
  stage4: number;
  warningCount: number;
  breachedCount: number;
}

export interface ApprovalInboxQueryResult {
  items: UnifiedApprovalItem[];
  counts: InboxCounts;
  nextCursor?: string | null;
}

export interface ApprovalInboxQueryOptions {
  status?: 'PENDING' | 'DECIDED' | 'ALL';
  stage?: 'ALL' | OperationalStage;
  type?: ApprovalType;
  sourceType?: 'ZMCC' | 'CONTRACTOR' | 'PLANT';
  limit?: number;
  cursor?: string;
}

function calculateSla(submittedAt: Date): { waitingMinutes: number; slaStatus: SlaStatus } {
  const diffMs = Date.now() - submittedAt.getTime();
  const waitingMinutes = Math.max(0, Math.floor(diffMs / 60000));
  let slaStatus: SlaStatus = 'NORMAL';
  if (waitingMinutes > 60) {
    slaStatus = 'BREACHED';
  } else if (waitingMinutes >= 15) {
    slaStatus = 'WARNING';
  }
  return { waitingMinutes, slaStatus };
}

function formatReasonChips(reasons: unknown): string[] {
  if (!Array.isArray(reasons)) return [];
  const chips: string[] = [];
  for (const r of reasons) {
    if (typeof r !== 'string') continue;
    const upper = r.toUpperCase();
    if (upper.includes('RULE') || upper.includes('FAIL') || upper.includes('OUT_OF_SPEC')) {
      chips.push('Rule Mismatch');
    } else if (upper.includes('PHOTO') || upper.includes('PICTURE')) {
      chips.push('Missing Photo');
    } else if (upper.includes('SEAL')) {
      chips.push('Seal Mismatch');
    } else if (upper.includes('GEOFENCE')) {
      chips.push('Outside Geofence');
    } else if (upper.includes('OVERRIDE') || upper.includes('DECISION_MISMATCH')) {
      chips.push('Operator Override');
    } else if (upper.includes('UNAPPROVED')) {
      chips.push('Unapproved Supplier');
    } else {
      chips.push(r.replace(/_/g, ' '));
    }
  }
  return Array.from(new Set(chips));
}

/**
 * Fetches and aggregates approval items from all 4 stages.
 */
export async function getApprovalInbox(
  actor: {
    id: string | bigint;
    role: CanonicalRole | string;
    procurementSourceId?: string | bigint | null;
    contractorId?: string | bigint | null;
  },
  options: ApprovalInboxQueryOptions = {}
): Promise<ApprovalInboxQueryResult> {
  const statusFilter = options.status || 'PENDING';
  const stageFilter = options.stage || 'ALL';
  const typeFilter = options.type;
  const limit = Math.min(Math.max(options.limit || 50, 1), 200);

  const actorSourceId = actor.procurementSourceId ? BigInt(actor.procurementSourceId) : null;
  const isZmccScoped = actor.role === 'ZMCC_MANAGER' || actor.role === 'MDO';
  const isContractorScoped = actor.role === 'CONTRACTOR_MANAGER';
  const isQaScoped = actor.role === 'QA_HEAD' || actor.role === 'QA_LAB_ATTENDANT';
  const isSuperOrAuditor =
    actor.role === 'SUPER_ADMIN' ||
    actor.role === 'DATA_EXECUTIVE' ||
    actor.role === 'EXECUTIVE_MANAGEMENT';

  const items: UnifiedApprovalItem[] = [];

  // ===============================================================================================
  // Stage 1 Queries: MOT Shop Collections, New Routes, New Shops
  // Only for ZMCC Manager / MDO or System Auditors (Super Admin, Data Executive)
  // ===============================================================================================
  if (
    (isZmccScoped || isSuperOrAuditor) &&
    (stageFilter === 'ALL' || stageFilter === 'STAGE_1')
  ) {
    // 1. MOT Shop Collections
    if (!typeFilter || typeFilter === 'STAGE_1_SHOP_EXCEPTION') {
      const motWhere: Prisma.MotShopCollectionWhereInput = {};
      if (statusFilter === 'PENDING') {
        motWhere.review_status = 'PENDING';
      } else if (statusFilter === 'DECIDED') {
        motWhere.review_status = { in: ['APPROVED', 'REJECTED'] };
      }
      if (isZmccScoped && actorSourceId) {
        motWhere.zmcc_id = actorSourceId;
      }

      const motCollections = await prisma.motShopCollection.findMany({
        where: motWhere,
        include: {
          journey: { select: { journey_number: true } },
          stop: { select: { shop_name_snapshot: true } },
          mot_profile: { select: { name: true } },
          zmcc: { select: { id: true, name: true, code: true } },
        },
        orderBy: statusFilter === 'DECIDED' ? { reviewed_at: 'desc' } : { device_collected_at: 'asc' },
        take: limit,
      });

      // Load submitter & reviewer users in bulk
      const submitterUserIds = Array.from(new Set(motCollections.map((c) => c.submitted_by_user_id).filter(Boolean)));
      const reviewerUserIds = Array.from(new Set(motCollections.map((c) => c.reviewed_by_user_id).filter((id): id is bigint => id !== null)));
      
      const submitterUsers = submitterUserIds.length > 0
        ? await prisma.user.findMany({ where: { id: { in: submitterUserIds } }, select: { id: true, full_name: true, username: true, role: true } })
        : [];
      const reviewerUsers = reviewerUserIds.length > 0
        ? await prisma.user.findMany({ where: { id: { in: reviewerUserIds } }, select: { id: true, full_name: true, username: true, role: true } })
        : [];

      const submittersMap = new Map(submitterUsers.map((u) => [u.id.toString(), u]));
      const reviewersMap = new Map(reviewerUsers.map((u) => [u.id.toString(), u]));

      // Load captured photos for these collections
      const motIds = motCollections.map((c) => c.id);
      const motPhotos = motIds.length > 0
        ? await prisma.capturedPhoto.findMany({
            where: { entity_type: { in: ['mot_shop_collection', 'MOT_SHOP_COLLECTION'] }, entity_id: { in: motIds } },
            select: { capture_id: true, lab_test_id: true, entity_id: true, file_path: true },
          })
        : [];
      const photosByMotId = new Map<string, typeof motPhotos>();
      for (const p of motPhotos) {
        const k = p.entity_id.toString();
        const list = photosByMotId.get(k) || [];
        list.push(p);
        photosByMotId.set(k, list);
      }

      for (const col of motCollections) {
        const submittedAt = col.device_collected_at || col.created_at;
        const { waitingMinutes, slaStatus } = calculateSla(submittedAt);
        const detailsObj = (col.decision_details && typeof col.decision_details === 'object' ? col.decision_details : {}) as Record<string, unknown>;

        const testValues: TestValueSnapshot[] = [
          {
            code: 'LR',
            name: 'Lactometer Reading (LR)',
            value: col.lr !== null ? Number(col.lr) : null,
            outcome: col.lr !== null && Number(col.lr) >= 28 ? 'PASS' : 'FAIL',
          },
          {
            code: 'FAT',
            name: 'Fat %',
            value: col.fat !== null ? Number(col.fat) : null,
            outcome: col.fat !== null && Number(col.fat) >= 3.5 ? 'PASS' : 'FAIL',
          },
        ];

        // Format captured photos
        const colPhotos = photosByMotId.get(col.id.toString()) || [];
        const mappedPhotos: PhotoSnapshot[] = colPhotos.map((p) => ({
          captureId: p.capture_id,
          labTestId: p.lab_test_id?.toString() ?? null,
          received: true,
          url: p.file_path ? `/api/photos/view/${p.capture_id}` : undefined,
        }));

        const submitterUser = submittersMap.get(col.submitted_by_user_id.toString());
        const reviewerUser = col.reviewed_by_user_id ? reviewersMap.get(col.reviewed_by_user_id.toString()) : null;
        const submitterId = col.submitted_by_user_id.toString();
        const submitterRole = submitterUser?.role || col.performed_as_role || 'MOT';

        const reasons = formatReasonChips(col.exception_reasons);
        if (reasons.length === 0) reasons.push('Rule Mismatch');

        const item: UnifiedApprovalItem = {
          id: `mot_${col.id}`,
          stage: 'STAGE_1',
          approvalType: 'STAGE_1_SHOP_EXCEPTION',
          referenceNumber: col.collection_number || `COL-${col.id}`,
          sourceId: col.zmcc_id.toString(),
          sourceName: col.zmcc?.name || 'ZMCC Area',
          zmccId: col.zmcc_id.toString(),
          submittedBy: {
            id: submitterId,
            name: submitterUser?.full_name || submitterUser?.username || col.mot_profile?.name || 'Mobile Tester',
            role: submitterRole,
            performedAsRole: col.performed_as_role,
            isDelegated: col.is_delegated,
          },
          submittedAt: submittedAt.toISOString(),
          waitingMinutes,
          slaStatus,
          reasonChips: reasons,
          canDecide: false,
          disabledReason: null,
          details: {
            entityTitle: `Shop: ${col.stop?.shop_name_snapshot || 'Field Shop'} (Journey: ${col.journey?.journey_number || 'N/A'})`,
            sourceName: col.zmcc?.name || 'ZMCC Area',
            sourceType: 'ZMCC',
            grossLiters: Number(col.gross_liters),
            testValues,
            photos: mappedPhotos,
            personDecision: col.person_decision === 'REJECT' ? 'REJECT' : 'ACCEPT',
            personRemarks: col.decision_remarks,
            formulaAudit: {
              policyVersion: typeof detailsObj.policyVersion === 'number' ? detailsObj.policyVersion : 1,
              capturedAt: submittedAt.toISOString(),
              gpsCoordinates:
                col.collection_latitude && col.collection_longitude
                  ? {
                      latitude: Number(col.collection_latitude),
                      longitude: Number(col.collection_longitude),
                      accuracy: col.collection_gps_accuracy ? Number(col.collection_gps_accuracy) : null,
                    }
                  : null,
            },
          },
          version: col.version,
          status: col.review_status === 'APPROVED' ? 'APPROVED' : col.review_status === 'REJECTED' ? 'REJECTED' : 'PENDING',
          decision:
            col.reviewed_at && reviewerUser
              ? {
                  decidedBy: reviewerUser.full_name || reviewerUser.username,
                  decidedAt: col.reviewed_at.toISOString(),
                  decidedAsRole: col.reviewed_as_role,
                  verdict: col.review_status === 'APPROVED' ? 'OKAY' : 'NO',
                  remarks: col.review_remarks,
                }
              : null,
        };

        items.push(item);
      }
    }

    // 2. New Route Requests
    if (!typeFilter || typeFilter === 'STAGE_1_NEW_ROUTE') {
      const routeWhere: Prisma.ZmccRouteWhereInput = {};
      if (statusFilter === 'PENDING') {
        routeWhere.approval_status = 'PENDING';
      } else if (statusFilter === 'DECIDED') {
        routeWhere.approval_status = { in: ['ACTIVE', 'REJECTED'] };
        routeWhere.approved_by = { not: null };
      }
      if (isZmccScoped && actorSourceId) {
        routeWhere.zmcc_id = actorSourceId;
      }

      const pendingRoutes = await prisma.zmccRoute.findMany({
        where: routeWhere,
        include: {
          zmcc: true,
          creator: { select: { id: true, full_name: true, username: true, role: true } },
        },
        orderBy: { created_at: 'desc' },
        take: limit,
      });

      const routeApproverIds = Array.from(new Set(pendingRoutes.map((r) => r.approved_by).filter((id): id is bigint => id !== null)));
      const routeApprovers: Array<{ id: bigint; full_name: string | null; username: string }> =
        routeApproverIds.length > 0
          ? await prisma.user.findMany({ where: { id: { in: routeApproverIds } }, select: { id: true, full_name: true, username: true } })
          : [];
      const routeApproversMap = new Map(routeApprovers.map((u) => [u.id.toString(), u]));

      for (const route of pendingRoutes) {
        const { waitingMinutes, slaStatus } = calculateSla(route.created_at);
        const submitterUser = route.creator;
        const submitterId = route.created_by?.toString() || '';
        const submitterRole = submitterUser?.role || route.created_as_role || 'MDO';
        const approverUser = route.approved_by ? routeApproversMap.get(route.approved_by.toString()) : null;

        items.push({
          id: `route_${route.id}`,
          stage: 'STAGE_1',
          approvalType: 'STAGE_1_NEW_ROUTE',
          referenceNumber: route.route_code,
          sourceId: route.zmcc_id.toString(),
          sourceName: route.zmcc?.name || 'ZMCC Area',
          zmccId: route.zmcc_id.toString(),
          submittedBy: {
            id: submitterId,
            name: submitterUser?.full_name || submitterUser?.username || 'Field Officer',
            role: submitterRole,
            performedAsRole: route.created_as_role,
            isDelegated: route.created_is_delegated,
          },
          submittedAt: route.created_at.toISOString(),
          waitingMinutes,
          slaStatus,
          reasonChips: ['New Route'],
          canDecide: false,
          disabledReason: null,
          details: {
            entityTitle: `Route: ${route.name} (${route.origin} → ${route.destination})`,
            sourceName: route.zmcc?.name || 'ZMCC Area',
            sourceType: 'ZMCC',
            metadata: {
              routeCode: route.route_code,
              origin: route.origin,
              destination: route.destination,
            },
          },
          version: 1,
          status: route.approval_status === 'ACTIVE' ? 'APPROVED' : route.approval_status === 'REJECTED' ? 'REJECTED' : 'PENDING',
          decision:
            route.approved_at && approverUser
              ? {
                  decidedBy: approverUser.full_name || approverUser.username,
                  decidedAt: route.approved_at.toISOString(),
                  verdict: route.approval_status === 'ACTIVE' ? 'OKAY' : 'NO',
                  remarks: route.rejection_reason,
                }
              : null,
        });
      }
    }

    // 3. New Shop Requests
    if (!typeFilter || typeFilter === 'STAGE_1_NEW_SHOP') {
      const shopWhere: Prisma.ZmccShopWhereInput = {};
      if (statusFilter === 'PENDING') {
        shopWhere.approval_status = { in: ['PENDING', 'PENDING_APPROVAL'] };
      } else if (statusFilter === 'DECIDED') {
        shopWhere.approval_status = { in: ['ACTIVE', 'REJECTED'] };
        shopWhere.approved_by = { not: null };
      }
      if (isZmccScoped && actorSourceId) {
        shopWhere.zmcc_id = actorSourceId;
      }

      const pendingShops = await prisma.zmccShop.findMany({
        where: shopWhere,
        include: {
          area: true,
          creator: { select: { id: true, full_name: true, username: true, role: true } },
        },
        orderBy: { created_at: 'desc' },
        take: limit,
      });

      const approverIds = Array.from(new Set(pendingShops.map((s) => s.approved_by).filter((id): id is bigint => id !== null)));
      const approverUsers: Array<{ id: bigint; full_name: string | null; username: string }> =
        approverIds.length > 0
          ? await prisma.user.findMany({ where: { id: { in: approverIds } }, select: { id: true, full_name: true, username: true } })
          : [];
      const approversMap = new Map(approverUsers.map((u) => [u.id.toString(), u]));

      for (const shop of pendingShops) {
        const { waitingMinutes, slaStatus } = calculateSla(shop.created_at);
        const submitterUser = shop.creator;
        const submitterId = shop.created_by?.toString() || '';
        const submitterRole = submitterUser?.role || shop.created_as_role || 'MOT';
        const approverUser = shop.approved_by ? approversMap.get(shop.approved_by.toString()) : null;

        items.push({
          id: `shop_${shop.id}`,
          stage: 'STAGE_1',
          approvalType: 'STAGE_1_NEW_SHOP',
          referenceNumber: shop.shop_code,
          sourceId: shop.zmcc_id.toString(),
          sourceName: 'ZMCC Area',
          zmccId: shop.zmcc_id.toString(),
          submittedBy: {
            id: submitterId,
            name: submitterUser?.full_name || submitterUser?.username || 'Mobile Tester',
            role: submitterRole,
            performedAsRole: shop.created_as_role,
            isDelegated: shop.created_is_delegated,
          },
          submittedAt: shop.created_at.toISOString(),
          waitingMinutes,
          slaStatus,
          reasonChips: ['New Shop'],
          canDecide: false,
          disabledReason: null,
          details: {
            entityTitle: `Shop: ${shop.shop_name} (Owner: ${shop.owner_name})`,
            sourceName: 'ZMCC Area',
            sourceType: 'ZMCC',
            metadata: {
              shopCode: shop.shop_code,
              phone: shop.phone_number,
              cnic: shop.cnic,
              areaName: shop.area?.name,
            },
          },
          version: 1,
          status: shop.approval_status === 'ACTIVE' ? 'APPROVED' : shop.approval_status === 'REJECTED' ? 'REJECTED' : 'PENDING',
          decision:
            shop.approved_at && approverUser
              ? {
                  decidedBy: approverUser.full_name || approverUser.username,
                  decidedAt: shop.approved_at.toISOString(),
                  verdict: shop.approval_status === 'ACTIVE' ? 'OKAY' : 'NO',
                  remarks: shop.rejection_reason,
                }
              : null,
        });
      }
    }
  }

  // ===============================================================================================
  // Stage 2 Queries: ZMCC Lab Portions, New HCs
  // Only for ZMCC Manager or System Auditors (Super Admin, Data Executive)
  // ===============================================================================================
  if (
    (isZmccScoped || isSuperOrAuditor) &&
    (stageFilter === 'ALL' || stageFilter === 'STAGE_2')
  ) {
    // 1. ZMCC Lab Portions
    if (!typeFilter || typeFilter === 'STAGE_2_PORTION_EXCEPTION') {
      const portionWhere: Prisma.ZmccLabPortionWhereInput = {};
      if (statusFilter === 'PENDING') {
        portionWhere.review_status = 'PENDING';
      } else if (statusFilter === 'DECIDED') {
        portionWhere.review_status = { in: ['APPROVED', 'REJECTED'] };
      }
      if (isZmccScoped && actorSourceId) {
        portionWhere.lab_session = { zmcc_id: actorSourceId };
      }

      const labPortions = await prisma.zmccLabPortion.findMany({
        where: portionWhere,
        include: {
          creator: { select: { id: true, full_name: true, username: true, role: true } },
          reviewer: { select: { id: true, full_name: true, username: true, role: true } },
          lab_session: {
            include: {
              zmcc: true,
              mot_arrival: true,
              local_supplier_arrival: true,
            },
          },
        },
        orderBy: statusFilter === 'DECIDED' ? { reviewed_at: 'desc' } : { decided_at: 'asc' },
        take: limit,
      });

      // Load portion photos
      const portionIds = labPortions.map((p) => p.id);
      const portionPhotos = portionIds.length > 0
        ? await prisma.capturedPhoto.findMany({
            where: { entity_type: 'zmcc_lab_portion', entity_id: { in: portionIds } },
            select: { capture_id: true, lab_test_id: true, entity_id: true, file_path: true },
          })
        : [];
      const photosByPortionId = new Map<string, typeof portionPhotos>();
      for (const p of portionPhotos) {
        const k = p.entity_id.toString();
        const list = photosByPortionId.get(k) || [];
        list.push(p);
        photosByPortionId.set(k, list);
      }

      for (const portion of labPortions) {
        const submittedAt = portion.decided_at || portion.created_at;
        const { waitingMinutes, slaStatus } = calculateSla(submittedAt);
        const detailsObj = (portion.decision_details && typeof portion.decision_details === 'object' ? portion.decision_details : {}) as Record<string, unknown>;

        const testValues: TestValueSnapshot[] = Array.isArray(detailsObj.tests)
          ? detailsObj.tests.map((t: unknown) => {
              const test = (t && typeof t === 'object' ? t : {}) as Record<string, unknown>;
              return {
                code: typeof test.testCode === 'string' ? test.testCode : 'TEST',
                name: typeof test.testName === 'string' ? test.testName : 'Lab Test',
                value: test.value !== null && test.value !== undefined ? (test.value as string | number) : (test.textValue as string | number | null),
                outcome: typeof test.outcome === 'string' ? test.outcome : undefined,
              };
            })
          : [
              {
                code: 'LR',
                name: 'Lactometer Reading (LR)',
                value: portion.lr !== null ? Number(portion.lr) : null,
                min: 28.0,
                pass: portion.lr !== null && Number(portion.lr) >= 28,
              },
              {
                code: 'FAT',
                name: 'Fat %',
                value: portion.fat !== null ? Number(portion.fat) : null,
                min: 3.5,
                pass: portion.fat !== null && Number(portion.fat) >= 3.5,
              },
            ];

        const pPhotos = photosByPortionId.get(portion.id.toString()) || [];
        const mappedPhotos: PhotoSnapshot[] = pPhotos.map((p) => ({
          captureId: p.capture_id,
          labTestId: p.lab_test_id?.toString() ?? null,
          received: true,
          url: p.file_path ? `/api/photos/view/${p.capture_id}` : undefined,
        }));

        const session = portion.lab_session;
        const zmccId = session?.zmcc_id?.toString() || '';
        const zmccName = session?.zmcc?.name || 'ZMCC';
        const submitterUser = portion.creator;
        const submitterId = portion.created_by_user_id?.toString() || submitterUser?.id?.toString() || '';
        const submitterRole = submitterUser?.role || portion.performed_as_role || 'ZMCC_LAB_ATTENDANT';

        const token = session?.mot_arrival?.zmcc_token || session?.local_supplier_arrival?.zmcc_token || `SES-${session?.id}`;
        const reasons = formatReasonChips(portion.exception_reasons);
        if (reasons.length === 0) reasons.push('Rule Mismatch');

        items.push({
          id: `lab_portion_${portion.id}`,
          stage: 'STAGE_2',
          approvalType: 'STAGE_2_PORTION_EXCEPTION',
          referenceNumber: `Token: ${token} (Portion ${portion.portion_number})`,
          sourceId: zmccId,
          sourceName: zmccName,
          zmccId,
          submittedBy: {
            id: submitterId,
            name: submitterUser?.full_name || submitterUser?.username || 'Zonal Lab Attendant',
            role: submitterRole,
            performedAsRole: portion.performed_as_role,
            isDelegated: portion.is_delegated,
          },
          submittedAt: submittedAt.toISOString(),
          waitingMinutes,
          slaStatus,
          reasonChips: reasons,
          canDecide: false,
          disabledReason: null,
          details: {
            entityTitle: `Session #${session?.id} · Portion ${portion.portion_number} (${session?.arrival_type || 'Intake'})`,
            sourceName: zmccName,
            sourceType: 'ZMCC',
            grossLiters: Number(portion.gross_liters || 0),
            testValues,
            photos: mappedPhotos,
            personDecision: portion.person_decision === 'REJECT' ? 'REJECT' : 'ACCEPT',
            personRemarks: portion.decision_remarks,
            metadata: {
              portionNumber: portion.portion_number,
              sessionId: session?.id?.toString(),
              arrivalType: session?.arrival_type,
              localSupplierArrivalId: session?.local_supplier_arrival?.id?.toString(),
              sourceInfo: detailsObj.sourceInfo || null,
              assignedMilkSourceId: session?.local_supplier_arrival?.milk_source_id?.toString() || null,
              assignedMilkSourceName: session?.local_supplier_arrival?.milk_source_name_snapshot || null,
              assignedMilkSourceCode: session?.local_supplier_arrival?.milk_source_code_snapshot || null,
            },
          },
          version: portion.version,
          status: portion.review_status === 'APPROVED' ? 'APPROVED' : portion.review_status === 'REJECTED' ? 'REJECTED' : 'PENDING',
          decision:
            portion.reviewed_at && portion.reviewer
              ? {
                  decidedBy: portion.reviewer.full_name || portion.reviewer.username,
                  decidedAt: portion.reviewed_at.toISOString(),
                  decidedAsRole: portion.reviewed_as_role,
                  verdict: portion.review_status === 'APPROVED' ? 'OKAY' : 'NO',
                  remarks: portion.review_remarks,
                }
              : null,
        });
      }
    }

    // 2. New HC (Local Supplier) Requests
    if (!typeFilter || typeFilter === 'STAGE_2_NEW_HC') {
      const hcWhere: Prisma.ZmccLocalSupplierWhereInput = {};
      if (statusFilter === 'PENDING') {
        hcWhere.approval_status = 'PENDING';
      } else if (statusFilter === 'DECIDED') {
        hcWhere.approval_status = { in: ['ACTIVE', 'REJECTED'] };
        hcWhere.approved_by_user_id = { not: null };
      }
      if (isZmccScoped && actorSourceId) {
        hcWhere.zmcc_id = actorSourceId;
      }

      const pendingHcs = await prisma.zmccLocalSupplier.findMany({
        where: hcWhere,
        include: {
          zmcc: true,
          creator: { select: { id: true, full_name: true, username: true, role: true } },
          approver: { select: { id: true, full_name: true, username: true, role: true } },
        },
        orderBy: { created_at: 'desc' },
        take: limit,
      });

      for (const hc of pendingHcs) {
        const { waitingMinutes, slaStatus } = calculateSla(hc.created_at);
        const submitterUser = hc.creator;
        const submitterId = hc.created_by_user_id?.toString() || '';
        const submitterRole = submitterUser?.role || hc.created_as_role || 'PHE_OPERATOR';

        items.push({
          id: `hc_${hc.id}`,
          stage: 'STAGE_2',
          approvalType: 'STAGE_2_NEW_HC',
          referenceNumber: hc.local_supplier_code,
          sourceId: hc.zmcc_id?.toString() || '',
          sourceName: hc.zmcc?.name || 'ZMCC Area',
          zmccId: hc.zmcc_id?.toString() || '',
          submittedBy: {
            id: submitterId,
            name: submitterUser?.full_name || submitterUser?.username || 'PHE Operator',
            role: submitterRole,
            performedAsRole: hc.created_as_role,
            isDelegated: hc.created_is_delegated,
          },
          submittedAt: hc.created_at.toISOString(),
          waitingMinutes,
          slaStatus,
          reasonChips: ['New HC'],
          canDecide: false,
          disabledReason: null,
          details: {
            entityTitle: `Local Supplier (HC): ${hc.name}`,
            sourceName: hc.zmcc?.name || 'ZMCC Area',
            sourceType: 'ZMCC',
            metadata: {
              code: hc.local_supplier_code,
              phone: hc.phone,
              cnic: hc.cnic,
            },
          },
          version: 1,
          status: hc.approval_status === 'ACTIVE' ? 'APPROVED' : hc.approval_status === 'REJECTED' ? 'REJECTED' : 'PENDING',
          decision:
            hc.approved_at && hc.approver
              ? {
                  decidedBy: hc.approver.full_name || hc.approver.username,
                  decidedAt: hc.approved_at.toISOString(),
                  verdict: hc.approval_status === 'ACTIVE' ? 'OKAY' : 'NO',
                  remarks: hc.rejection_reason,
                }
              : null,
        });
      }
    }
  }

  // ===============================================================================================
  // Stage 3 Queries: ZMCC & Contractor Dispatches
  // ===============================================================================================
  if (
    (!isQaScoped) &&
    (stageFilter === 'ALL' || stageFilter === 'STAGE_3')
  ) {
    const dispatchWhere: Prisma.VehicleVisitWhereInput = {};
    if (statusFilter === 'PENDING') {
      dispatchWhere.approval_status = 'PENDING';
      dispatchWhere.current_status = 'PENDING_APPROVAL';
    } else if (statusFilter === 'DECIDED') {
      dispatchWhere.approval_status = { in: ['APPROVED', 'RETURNED'] };
    }

    if (isZmccScoped && actorSourceId) {
      dispatchWhere.procurement_source_id = actorSourceId;
    } else if (isContractorScoped && actor.contractorId) {
      dispatchWhere.procurement_source_id = BigInt(actor.contractorId);
    }

    if (options.sourceType === 'CONTRACTOR') {
      dispatchWhere.procurement_source = { source_type: 'CONTRACTOR' };
    } else if (options.sourceType === 'ZMCC') {
      dispatchWhere.procurement_source = { source_type: 'ZMCC' };
    }

    const dispatches = await prisma.vehicleVisit.findMany({
      where: dispatchWhere,
      include: {
        procurement_source: true,
        approval_requester: { select: { id: true, full_name: true, username: true, role: true } },
        approval_decider: { select: { id: true, full_name: true, username: true, role: true } },
        creator: { select: { id: true, full_name: true, username: true, role: true } },
        portions: true,
      },
      orderBy: statusFilter === 'DECIDED' ? { approval_decided_at: 'desc' } : { approval_requested_at: 'asc' },
      take: limit,
    });

    for (const disp of dispatches) {
      const isContractor = (disp.procurement_source?.source_type || '').toUpperCase() === 'CONTRACTOR';
      const approvalType: ApprovalType = isContractor
        ? 'STAGE_3_CONTRACTOR_DISPATCH_EXCEPTION'
        : 'STAGE_3_ZMCC_DISPATCH_EXCEPTION';

      if (typeFilter && typeFilter !== approvalType) continue;

      const submittedAt = disp.approval_requested_at || disp.dispatch_submitted_at || disp.updated_at;
      const { waitingMinutes, slaStatus } = calculateSla(submittedAt);

      const submitterUser = disp.approval_requester || disp.creator;
      const submitterId = submitterUser?.id?.toString() || '';
      const submitterRole = submitterUser?.role || disp.approval_requested_as_role || (isContractor ? 'CONTRACTOR_OPERATOR' : 'ZMCC_LAB_ATTENDANT');

      const reasons = formatReasonChips(disp.dispatch_exception_reasons);
      if (reasons.length === 0) reasons.push('Dispatch Approval Required');

      const testValues: TestValueSnapshot[] = [
        {
          code: 'WEIGHTED_LR',
          name: 'Weighted LR',
          value: disp.vehicle_dispatch_lr !== null ? Number(disp.vehicle_dispatch_lr) : null,
          min: 28.0,
          pass: disp.vehicle_dispatch_lr !== null && Number(disp.vehicle_dispatch_lr) >= 28,
        },
        {
          code: 'WEIGHTED_FAT',
          name: 'Weighted Fat %',
          value: disp.vehicle_dispatch_fat !== null ? Number(disp.vehicle_dispatch_fat) : null,
          min: 3.5,
          pass: disp.vehicle_dispatch_fat !== null && Number(disp.vehicle_dispatch_fat) >= 3.5,
        },
      ];

      items.push({
        id: `dispatch_${disp.id}`,
        stage: 'STAGE_3',
        approvalType,
        referenceNumber: disp.reception_number || disp.visit_number || `DISP-${disp.id}`,
        sourceId: disp.procurement_source_id?.toString() || '',
        sourceName: disp.procurement_source?.name || 'Dispatch Station',
        zmccId: isContractor ? null : disp.procurement_source_id?.toString(),
        contractorId: isContractor ? disp.procurement_source_id?.toString() : null,
        submittedBy: {
          id: submitterId,
          name: submitterUser?.full_name || submitterUser?.username || (isContractor ? 'Contractor Operator' : 'Zonal Lab Attendant'),
          role: submitterRole,
          performedAsRole: disp.approval_requested_as_role,
          isDelegated: disp.approval_requested_is_delegated,
        },
        submittedAt: submittedAt.toISOString(),
        waitingMinutes,
        slaStatus,
        reasonChips: reasons,
        canDecide: false,
        disabledReason: null,
        details: {
          entityTitle: `Dispatch: Vehicle ${disp.vehicle_number} (${disp.procurement_source?.name})`,
          sourceName: disp.procurement_source?.name || 'Dispatch Source',
          sourceType: isContractor ? 'CONTRACTOR' : 'ZMCC',
          vehicleNumber: disp.vehicle_number,
          grossLiters: Number(disp.vehicle_dispatch_gross_liters || 0),
          testValues,
          personDecision: disp.dispatch_person_decision === 'REJECT' ? 'REJECT' : 'ACCEPT',
          personRemarks: disp.dispatch_decision_remarks,
          metadata: {
            testMode: disp.test_mode,
            portionsCount: disp.portions.length,
            weightedTs13: Number(disp.vehicle_dispatch_at_13ts_liters || 0),
          },
        },
        version: disp.dispatch_version,
        status: disp.approval_status === 'APPROVED' ? 'APPROVED' : disp.approval_status === 'RETURNED' ? 'REJECTED' : 'PENDING',
        decision:
          disp.approval_decided_at && disp.approval_decider
            ? {
                decidedBy: disp.approval_decider.full_name || disp.approval_decider.username,
                decidedAt: disp.approval_decided_at.toISOString(),
                decidedAsRole: disp.approval_decided_as_role,
                verdict: disp.approval_status === 'APPROVED' ? 'OKAY' : 'NO',
                remarks: disp.approval_decision_remarks,
              }
            : null,
      });
    }
  }

  // ===============================================================================================
  // Stage 4 Queries: Plant QA Reception Portions
  // ===============================================================================================
  if (
    (actor.role === 'QA_LAB_ATTENDANT' || actor.role === 'QA_HEAD' || actor.role === 'SUPER_ADMIN' || actor.role === 'DATA_EXECUTIVE' || actor.role === 'EXECUTIVE_MANAGEMENT') &&
    (stageFilter === 'ALL' || stageFilter === 'STAGE_4')
  ) {
    if (!typeFilter || typeFilter === 'STAGE_4_PORTION_EXCEPTION') {
      const qaWhere: Prisma.VisitPortionWhereInput = {};
      if (statusFilter === 'PENDING') {
        qaWhere.manager_review_status = 'PENDING';
      } else if (statusFilter === 'DECIDED') {
        qaWhere.manager_review_status = { in: ['APPROVED', 'REJECTED', 'REVIEWED_EXITED'] };
      }

      const plantPortions = await prisma.visitPortion.findMany({
        where: qaWhere,
        include: {
          visit: {
            include: {
              procurement_source: true,
              gate_log: true,
            },
          },
          plant_lab_results: {
            include: {
              lab_test: true,
              applied_rule: true,
            },
          },
          manager_requester: { select: { id: true, full_name: true, username: true, role: true } },
          manager_reviewer: { select: { id: true, full_name: true, username: true, role: true } },
        },
        orderBy: statusFilter === 'DECIDED' ? { manager_reviewed_at: 'desc' } : { manager_review_requested_at: 'asc' },
        take: limit,
      });

      for (const p of plantPortions) {
        const submittedAt = p.manager_review_requested_at || p.created_at;
        const { waitingMinutes, slaStatus } = calculateSla(submittedAt);

        const submitterUser = p.manager_requester;
        const submitterId = submitterUser?.id?.toString() || '';
        const submitterRole = submitterUser?.role || 'QA_LAB_ATTENDANT';

        const testValues: TestValueSnapshot[] = p.plant_lab_results.map((r) => ({
          code: r.lab_test?.testCode || 'TEST',
          name: r.lab_test?.testName || 'QA Test',
          value: r.numeric_value !== null ? Number(r.numeric_value) : r.text_value,
          min: r.applied_rule?.min_value !== null && r.applied_rule?.min_value !== undefined ? Number(r.applied_rule.min_value) : null,
          max: r.applied_rule?.max_value !== null && r.applied_rule?.max_value !== undefined ? Number(r.applied_rule.max_value) : null,
          pass: r.is_passed,
          outcome: r.is_passed ? 'PASS' : 'FAIL',
        }));

        const reasons: string[] = [];
        if (p.seal_match === false) {
          reasons.push('Seal Mismatch');
        }
        if (p.system_quality_outcome === 'FAIL') {
          reasons.push('Rule Mismatch');
        }
        if (reasons.length === 0) {
          reasons.push('Quality Exception');
        }

        items.push({
          id: `plant_portion_${p.id}`,
          stage: 'STAGE_4',
          approvalType: 'STAGE_4_PORTION_EXCEPTION',
          referenceNumber: `Visit ${p.visit?.vehicle_number || p.visit_id} · P${p.portion_number}`,
          sourceId: p.visit?.procurement_source_id?.toString() || '',
          sourceName: p.visit?.procurement_source?.name || 'Plant Reception',
          submittedBy: {
            id: submitterId,
            name: submitterUser?.full_name || submitterUser?.username || 'QAE Reception Lab',
            role: submitterRole,
            performedAsRole: null,
            isDelegated: false,
          },
          submittedAt: submittedAt.toISOString(),
          waitingMinutes,
          slaStatus,
          reasonChips: reasons,
          canDecide: false,
          disabledReason: null,
          details: {
            entityTitle: `Plant Reception: Vehicle ${p.visit?.vehicle_number} (Portion ${p.portion_number})`,
            sourceName: p.visit?.procurement_source?.name || 'Plant Reception',
            sourceType: 'PLANT',
            vehicleNumber: p.visit?.vehicle_number,
            sealNumber: p.seal_number,
            plantSealNumberEntered: p.plant_seal_number_entered,
            sealMatch: p.seal_match,
            testValues,
            personDecision: p.manager_requested_decision === 'REJECT' ? 'REJECT' : 'ACCEPT',
            personRemarks: p.manager_review_reason,
            metadata: {
              portionId: p.id.toString(),
              visitId: p.visit_id.toString(),
              systemQualityOutcome: p.system_quality_outcome,
            },
          },
          version: Math.floor(p.updated_at.getTime() / 1000),
          status: p.manager_review_status === 'APPROVED' ? 'APPROVED' : p.manager_review_status === 'REJECTED' ? 'REJECTED' : 'PENDING',
          decision:
            p.manager_reviewed_at && p.manager_reviewer
              ? {
                  decidedBy: p.manager_reviewer.full_name || p.manager_reviewer.username,
                  decidedAt: p.manager_reviewed_at.toISOString(),
                  verdict: p.manager_review_status === 'APPROVED' ? 'OKAY' : 'NO',
                  remarks: p.manager_review_reason,
                }
              : null,
        });
      }
    }
  }

  // Filter by sourceType if explicitly requested
  const scopedItems = options.sourceType
    ? items.filter((item) => item.details.sourceType === options.sourceType)
    : items;

  // ===============================================================================================
  // Apply Segregation of Duties Check & Sort
  // ===============================================================================================
  for (const item of scopedItems) {
    const decisionCheck = canDecideApproval(
      {
        userId: actor.id,
        role: actor.role,
        procurementSourceId: actor.procurementSourceId,
        contractorId: actor.contractorId,
      },
      {
        approvalType: item.approvalType,
        submittedByUserId: item.submittedBy.id,
        submitterRole: item.submittedBy.role,
        zmccId: item.zmccId,
        contractorId: item.contractorId,
      }
    );
    item.canDecide = decisionCheck.allowed;
    item.disabledReason = decisionCheck.disabledReason || null;
  }

  // Filter out non-actionable items for operational roles in PENDING mode:
  // An operational approver's pending queue must only show items they can actually decide.
  // Governance and auditor roles may review all pending items across stages.
  const isAuditorOrViewer = ['DATA_EXECUTIVE', 'SUPER_ADMIN'].includes(actor.role);
  const activeItems =
    statusFilter === 'PENDING' && !isAuditorOrViewer
      ? scopedItems.filter((item) => item.canDecide === true)
      : scopedItems;

  // Sort: Pending items by SLA urgency (BREACHED first, then WARNING, then NORMAL; within group, oldest waiting first)
  // Decided items by decidedAt desc
  activeItems.sort((a, b) => {
    if (a.status === 'PENDING' && b.status === 'PENDING') {
      const priorityWeight: Record<SlaStatus, number> = { BREACHED: 3, WARNING: 2, NORMAL: 1 };
      const weightDiff = priorityWeight[b.slaStatus] - priorityWeight[a.slaStatus];
      if (weightDiff !== 0) return weightDiff;
      return b.waitingMinutes - a.waitingMinutes;
    }
    return new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime();
  });

  // Calculate Metrics / Counts
  const counts: InboxCounts = {
    totalPending: 0,
    stage1: 0,
    stage2: 0,
    stage3: 0,
    stage4: 0,
    warningCount: 0,
    breachedCount: 0,
  };

  for (const item of activeItems) {
    if (item.status === 'PENDING') {
      counts.totalPending++;
      if (item.stage === 'STAGE_1') counts.stage1++;
      if (item.stage === 'STAGE_2') counts.stage2++;
      if (item.stage === 'STAGE_3') counts.stage3++;
      if (item.stage === 'STAGE_4') counts.stage4++;
      if (item.slaStatus === 'WARNING') counts.warningCount++;
      if (item.slaStatus === 'BREACHED') counts.breachedCount++;
    }
  }

  return {
    items: activeItems,
    counts,
    nextCursor: null,
  };
}
