/**
 * Submitter Request Service
 *
 * Allows lower-level operational roles (Zonal Lab Attendants, MOT Collectors,
 * PHE Operators, Gate Officers) to view the real-time status of requests and exceptions
 * they have submitted to higher hierarchy management (ZMCC Manager, MPD Head, QA Head).
 */

import { prisma } from '@/backend/core/db';
import { reasonSentences, storedDecisionTests } from '@/lib/exceptionReasons';

export interface SubmitterRequestItem {
  id: string;
  requestType: 'LAB_PORTION_REVIEW' | 'LAB_SESSION_REVIEW' | 'MOT_EXCEPTION' | 'DISPATCH_CLEARANCE';
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
  /** Why it was sent, one sentence each, from the reasons stored when it was sent. */
  reasons: string[];
  metadata?: Record<string, unknown>;
}

export async function getMySubmittedRequests(
  userId: bigint,
  zmccId?: bigint,
  userRole?: string
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
          mot_arrival: {
            select: {
              raw_milk_token_number: true,
              zmcc_token: true,
              journey: { select: { journey_number: true, mot_vehicle: { select: { vehicle_number: true } } } },
            },
          },
        },
      },
      reviewer: { select: { full_name: true, role: true } },
    },
  });

  for (const p of labPortions) {
    const token =
      p.lab_session?.local_supplier_arrival?.zmcc_token ||
      p.lab_session?.mot_arrival?.zmcc_token ||
      p.lab_session?.mot_arrival?.raw_milk_token_number ||
      `Session #${p.lab_session_id}`;
    const vehNum =
      p.lab_session?.mot_arrival?.journey?.mot_vehicle?.vehicle_number ||
      p.lab_session?.local_supplier_arrival?.vehicle_number ||
      null;

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
      referenceNumber: `${vehNum ? `Vehicle ${vehNum} · ` : ''}Portion #${p.portion_number} (${token})`,
      submittedAt: p.decided_at ? p.decided_at.toISOString() : new Date().toISOString(),
      status,
      statusLabel,
      statusTone,
      reviewerRole: p.reviewed_as_role || 'ZMCC Manager',
      reviewerName: p.reviewer?.full_name || null,
      reviewedAt: p.reviewed_at ? p.reviewed_at.toISOString() : null,
      reviewRemarks: p.review_remarks || p.decision_remarks || null,
      reasons: reasonSentences(p.exception_reasons, storedDecisionTests(p.decision_details)),
      summary: `Requested: ${p.person_decision === 'REJECT' ? 'Reject' : 'Accept'} · LR ${p.lr ?? '—'}, Fat ${p.fat ?? '—'}% · System: ${p.system_outcome || 'FLAGGED'}`,
      metadata: {
        portionNumber: p.portion_number,
        sessionId: p.lab_session_id.toString(),
        vehicleNumber: vehNum,
      },
    });
  }

  // 1b. ZMCC Lab Sessions (Whole-intake arrivals: MOT and Local Suppliers)
  const labSessions = await prisma.zmccLabSession.findMany({
    where: {
      OR: [
        { completed_by_user_id: userId, manager_review_status: { not: 'NONE' } },
        { manager_review_requested_by_user_id: userId },
        ...(zmccId ? [{ zmcc_id: zmccId, manager_review_status: { not: 'NONE' } }] : []),
      ],
    },
    take: 30,
    orderBy: { created_at: 'desc' },
    include: {
      local_supplier_arrival: { select: { zmcc_token: true, vehicle_number: true } },
      mot_arrival: { select: { raw_milk_token_number: true, zmcc_token: true, journey: { select: { journey_number: true, mot_vehicle: { select: { vehicle_number: true } } } } } },
      manager_reviewer: { select: { full_name: true, role: true } },
    },
  });

  for (const s of labSessions) {
    const token =
      s.local_supplier_arrival?.zmcc_token ||
      s.mot_arrival?.zmcc_token ||
      s.mot_arrival?.raw_milk_token_number ||
      `Session #${s.id}`;
    const vehNum = s.mot_arrival?.journey?.mot_vehicle?.vehicle_number || s.local_supplier_arrival?.vehicle_number;

    let status: 'PENDING' | 'APPROVED' | 'REJECTED' = 'PENDING';
    let statusLabel = 'Pending Manager Review';
    let statusTone: 'warning' | 'success' | 'danger' = 'warning';

    if (s.manager_review_status === 'APPROVED' || (s.final_decision === 'ACCEPTED' && s.manager_reviewed_by_user_id)) {
      status = 'APPROVED';
      statusLabel = 'Approved (Accepted)';
      statusTone = 'success';
    } else if (s.manager_review_status === 'REJECTED' || s.manager_review_status === 'REVIEWED_EXITED' || (s.final_decision === 'REJECTED' && s.manager_reviewed_by_user_id)) {
      status = 'REJECTED';
      statusLabel = 'Rejected';
      statusTone = 'danger';
    }

    items.push({
      id: `session-${s.id}`,
      requestType: 'LAB_SESSION_REVIEW',
      categoryLabel: 'Lab Quality Review',
      referenceNumber: `Token: ${token}${vehNum ? ` (${vehNum})` : ''}`,
      submittedAt: s.manager_review_requested_at ? s.manager_review_requested_at.toISOString() : s.created_at.toISOString(),
      status,
      statusLabel,
      statusTone,
      reviewerRole: s.manager_reviewed_as_role || 'ZMCC Manager',
      reviewerName: s.manager_reviewer?.full_name || null,
      reviewedAt: s.manager_reviewed_at ? s.manager_reviewed_at.toISOString() : null,
      reviewRemarks: s.manager_review_reason || s.remarks || null,
      reasons: s.rejection_reason ? [s.rejection_reason] : [],
      summary: `${s.arrival_type} Intake (${token}): ${s.gross_liters ?? '—'} L. Outcome: ${s.system_quality_outcome || 'FLAGGED'}.`,
      metadata: { sessionId: s.id.toString(), arrivalType: s.arrival_type, vehicleNumber: vehNum || null },
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
      reasons: reasonSentences(c.exception_reasons, storedDecisionTests(c.decision_details)),
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
    } else if (v.approval_status === 'REJECTED') {
      status = 'REJECTED';
      statusLabel = 'Rejected';
      statusTone = 'danger';
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
      reasons: reasonSentences(v.dispatch_exception_reasons, storedDecisionTests(v.dispatch_decision_details)),
      summary: `Vehicle ${v.vehicle_number}: Dispatched ${v.vehicle_dispatch_gross_liters ?? '—'} L. Status: ${v.current_status}`,
      metadata: { vehicleNumber: v.vehicle_number },
    });
  }

  // 4. Plant QA Portions escalated to AVP QA
  const plantPortions = await prisma.visitPortion.findMany({
    where: {
      manager_review_status: { not: 'NONE' },
      ...(userRole === 'QA_LAB_ATTENDANT' || userRole === 'QA_HEAD' || userRole === 'SUPER_ADMIN'
        ? {}
        : {
            OR: [
              { manager_review_requested_by_user_id: userId },
              { visit: { created_by: userId } },
              { plant_lab_results: { some: { tested_by: userId } } },
            ],
          }),
    },
    take: 30,
    orderBy: { updated_at: 'desc' },
    include: {
      visit: { select: { vehicle_number: true, token_number: true } },
      manager_reviewer: { select: { full_name: true, role: true } },
    },
  });

  for (const vp of plantPortions) {
    let status: 'PENDING' | 'APPROVED' | 'REJECTED' = 'PENDING';
    let statusLabel = 'Pending AVP-QA Review';
    let statusTone: 'warning' | 'success' | 'danger' = 'warning';

    if (vp.manager_review_status === 'APPROVED' || vp.plant_decision === 'ACCEPTED') {
      status = 'APPROVED';
      statusLabel = 'Approved (Accepted)';
      statusTone = 'success';
    } else if (vp.manager_review_status === 'REJECTED' || vp.plant_decision === 'REJECTED') {
      status = 'REJECTED';
      statusLabel = 'Rejected';
      statusTone = 'danger';
    }

    items.push({
      id: `plant-portion-${vp.id}`,
      requestType: 'LAB_PORTION_REVIEW',
      categoryLabel: 'Plant QA Exception',
      referenceNumber: `${vp.visit.vehicle_number}${vp.visit.token_number ? ` · Token ${vp.visit.token_number}` : ''} · P${vp.portion_number}`,
      submittedAt: vp.manager_review_requested_at ? vp.manager_review_requested_at.toISOString() : vp.updated_at.toISOString(),
      status,
      statusLabel,
      statusTone,
      reviewerRole: 'AVP QA Reception Lab',
      reviewerName: vp.manager_reviewer?.full_name || null,
      reviewedAt: vp.manager_reviewed_at ? vp.manager_reviewed_at.toISOString() : null,
      reviewRemarks: vp.manager_review_reason || null,
      reasons: reasonSentences(vp.exception_reasons),
      summary: `Vehicle ${vp.visit.vehicle_number}${vp.visit.token_number ? ` (Token ${vp.visit.token_number})` : ''} (Portion ${vp.portion_number}): Requested ${vp.manager_requested_decision || 'ACCEPT'}. Final: ${vp.plant_decision || 'PENDING'}.`,
      metadata: {
        portionId: vp.id.toString(),
        visitId: vp.visit_id.toString(),
        vehicleNumber: vp.visit.vehicle_number,
        tokenNumber: vp.visit.token_number,
      },
    });
  }

  // Sort descending by submission date
  return items.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
}
