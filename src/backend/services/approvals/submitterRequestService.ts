/**
 * Submitter Request Service
 *
 * Allows lower-level operational roles (Zonal Lab Attendants, MOT Collectors,
 * PHE Operators, Gate Officers) to view the real-time status of requests and exceptions
 * they have submitted to higher hierarchy management (ZMCC Manager, MPD Head, QA Head).
 */

import { prisma } from '@/backend/core/db';

export interface SubmitterRequestItem {
  id: string;
  requestType: 'LAB_PORTION_REVIEW' | 'LAB_SESSION_REVIEW' | 'MOT_EXCEPTION' | 'DISPATCH_CLEARANCE' | 'CORRECTION_REQUEST';
  categoryLabel: string;
  referenceNumber: string;
  submittedAt: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'RETURNED';
  statusLabel: string;
  statusTone: 'warning' | 'success' | 'danger' | 'default';
  reviewerRole: string;
  reviewerName: string | null;
  reviewedAt: string | null;
  reviewRemarks: string | null;
  summary: string;
  metadata?: Record<string, any>;
}

export async function getMySubmittedRequests(
  userId: bigint,
  zmccId?: bigint
): Promise<SubmitterRequestItem[]> {
  const items: SubmitterRequestItem[] = [];

  // 1. ZMCC Lab Portions requested by this user or in user's lab sessions
  const labPortions = await prisma.zmccLabPortion.findMany({
    where: {
      OR: [
        { created_by_user_id: userId, review_status: { not: 'NONE' } },
        { reviewed_by_user_id: { not: null }, created_by_user_id: userId },
        ...(zmccId
          ? [{ lab_session: { zmcc_id: zmccId }, review_status: { not: 'NONE' } }]
          : []),
      ],
    },
    take: 30,
    orderBy: { decided_at: 'desc' },
    include: {
      lab_session: {
        include: {
          local_supplier_arrival: { select: { zmcc_token: true, vehicle_number: true } },
          mot_arrival: { select: { raw_milk_token_number: true, journey: { select: { journey_number: true } } } },
        },
      },
      reviewer: { select: { full_name: true, role: true } },
    },
  });

  for (const p of labPortions) {
    const token =
      p.lab_session?.local_supplier_arrival?.zmcc_token ||
      p.lab_session?.mot_arrival?.raw_milk_token_number ||
      `Session #${p.lab_session_id}`;

    let status: 'PENDING' | 'APPROVED' | 'REJECTED' = 'PENDING';
    let statusLabel = 'Pending Manager Review';
    let statusTone: 'warning' | 'success' | 'danger' = 'warning';

    if (p.review_status === 'APPROVED' || (p.final_decision === 'ACCEPTED' && p.reviewed_by_user_id)) {
      status = 'APPROVED';
      statusLabel = 'Approved (Passed)';
      statusTone = 'success';
    } else if (p.review_status === 'REJECTED' || (p.final_decision === 'REJECTED' && p.reviewed_by_user_id)) {
      status = 'REJECTED';
      statusLabel = 'Rejected (Failed)';
      statusTone = 'danger';
    }

    items.push({
      id: `portion-${p.id}`,
      requestType: 'LAB_PORTION_REVIEW',
      categoryLabel: 'Lab Quality Review',
      referenceNumber: `Portion #${p.portion_number} (${token})`,
      submittedAt: p.decided_at ? p.decided_at.toISOString() : new Date().toISOString(),
      status,
      statusLabel,
      statusTone,
      reviewerRole: p.reviewed_as_role || 'ZMCC Manager',
      reviewerName: p.reviewer?.full_name || null,
      reviewedAt: p.reviewed_at ? p.reviewed_at.toISOString() : null,
      reviewRemarks: p.review_remarks || p.decision_remarks || null,
      summary: `Portion #${p.portion_number}: LR ${p.lr ?? '—'}, Fat ${p.fat ?? '—'}%. System: ${p.system_outcome || 'FLAGGED'}`,
      metadata: { portionNumber: p.portion_number, sessionId: p.lab_session_id.toString() },
    });
  }

  // 2. MOT Collection Exceptions submitted by this user
  const motCollections = await prisma.motShopCollection.findMany({
    where: {
      submitted_by_user_id: userId,
      review_status: { not: 'NONE' },
    },
    take: 30,
    orderBy: { created_at: 'desc' },
    include: {
      reviewed_by: { select: { full_name: true, role: true } },
      shop: { select: { shop_code: true, shop_name: true } },
    },
  });

  for (const c of motCollections) {
    let status: 'PENDING' | 'APPROVED' | 'REJECTED' = 'PENDING';
    let statusLabel = 'Pending Review';
    let statusTone: 'warning' | 'success' | 'danger' = 'warning';

    if (c.review_status === 'APPROVED' || c.final_decision === 'ACCEPTED') {
      status = 'APPROVED';
      statusLabel = 'Approved (Accepted)';
      statusTone = 'success';
    } else if (c.review_status === 'REJECTED' || c.final_decision === 'REJECTED') {
      status = 'REJECTED';
      statusLabel = 'Rejected';
      statusTone = 'danger';
    }

    items.push({
      id: `coll-${c.id}`,
      requestType: 'MOT_EXCEPTION',
      categoryLabel: 'Route Collection Exception',
      referenceNumber: c.collection_number,
      submittedAt: c.created_at.toISOString(),
      status,
      statusLabel,
      statusTone,
      reviewerRole: c.reviewed_as_role || 'ZMCC Manager',
      reviewerName: c.reviewed_by?.full_name || null,
      reviewedAt: c.reviewed_at ? c.reviewed_at.toISOString() : null,
      reviewRemarks: c.review_remarks || c.decision_remarks || null,
      summary: `${c.shop?.shop_name || 'Shop'}: ${c.gross_liters} L, Fat ${c.fat}%, LR ${c.lr}.`,
      metadata: { shopName: c.shop?.shop_name, liters: Number(c.gross_liters) },
    });
  }

  // 3. Tanker Dispatch Approvals requested by this user
  const visits = await prisma.vehicleVisit.findMany({
    where: {
      OR: [
        { approval_requested_by: userId, approval_status: { not: 'NONE' } },
        ...(zmccId ? [{ procurement_source_id: zmccId, approval_status: { not: 'NONE' } }] : []),
      ],
    },
    take: 20,
    orderBy: { created_at: 'desc' },
    include: {
      approval_decider: { select: { full_name: true, role: true } },
    },
  });

  for (const v of visits) {
    let status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'RETURNED' = 'PENDING';
    let statusLabel = 'Waiting Approval';
    let statusTone: 'warning' | 'success' | 'danger' = 'warning';

    if (v.approval_status === 'APPROVED') {
      status = 'APPROVED';
      statusLabel = 'Approved for Dispatch';
      statusTone = 'success';
    } else if (v.approval_status === 'RETURNED') {
      status = 'RETURNED';
      statusLabel = 'Returned / Corrected';
      statusTone = 'danger';
    }

    items.push({
      id: `visit-${v.id}`,
      requestType: 'DISPATCH_CLEARANCE',
      categoryLabel: 'Tanker Dispatch Clearance',
      referenceNumber: v.visit_number,
      submittedAt: v.approval_requested_at ? v.approval_requested_at.toISOString() : v.created_at.toISOString(),
      status,
      statusLabel,
      statusTone,
      reviewerRole: v.approver_role || 'ZMCC Manager',
      reviewerName: v.approval_decider?.full_name || null,
      reviewedAt: v.approval_decided_at ? v.approval_decided_at.toISOString() : null,
      reviewRemarks: v.approval_decision_remarks || null,
      summary: `Vehicle ${v.vehicle_number}: Dispatched ${v.vehicle_dispatch_gross_liters ?? '—'} L. Status: ${v.current_status}`,
      metadata: { vehicleNumber: v.vehicle_number },
    });
  }

  // 4. Data Correction Requests requested by this user
  const corrections = await prisma.correctionRequest.findMany({
    where: { requested_by_user_id: userId },
    take: 20,
    orderBy: { requested_at: 'desc' },
    include: {
      reviewer: { select: { full_name: true, role: true } },
    },
  });

  for (const cr of corrections) {
    let status: 'PENDING' | 'APPROVED' | 'REJECTED' = 'PENDING';
    let statusLabel = 'Requested';
    let statusTone: 'warning' | 'success' | 'danger' = 'warning';

    if (cr.status === 'APPROVED') {
      status = 'APPROVED';
      statusLabel = 'Correction Approved';
      statusTone = 'success';
    } else if (cr.status === 'REJECTED') {
      status = 'REJECTED';
      statusLabel = 'Correction Rejected';
      statusTone = 'danger';
    }

    items.push({
      id: `corr-${cr.id}`,
      requestType: 'CORRECTION_REQUEST',
      categoryLabel: 'Data Correction Governance',
      referenceNumber: cr.correlation_id,
      submittedAt: cr.requested_at.toISOString(),
      status,
      statusLabel,
      statusTone,
      reviewerRole: 'Governance / Manager',
      reviewerName: cr.reviewer?.full_name || null,
      reviewedAt: cr.reviewed_at ? cr.reviewed_at.toISOString() : null,
      reviewRemarks: cr.review_reason || null,
      summary: `Module ${cr.module}: ${cr.reason}`,
      metadata: { module: cr.module, impact: cr.impact },
    });
  }

  // Sort descending by submission date
  return items.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
}
