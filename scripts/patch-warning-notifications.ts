import fs from 'fs';

// 1. Patch motCore.ts
const motCorePath = 'src/backend/services/mot/motCore.ts';
let motCore = fs.readFileSync(motCorePath, 'utf8');

const motTarget = `      if (decision.route === 'SEND_TO_APPROVER') {
        await createNotificationsForEvent(tx, {
          eventKey: 'MOT_SHOP_EXCEPTION_PENDING',
          sourceId: collection.id.toString(),
          sourceZmccId: stop.journey.zmcc_id,
          title: 'Shop milk needs your decision',
          body: \`Shop \${stop.shop_name_snapshot} (\${stop.shop_code_snapshot}): \${decision.exceptionReasons.join(', ')}. MOT said \${personDecision === 'ACCEPT' ? 'accept' : 'reject'}.\${decisionRemarks ? \` Reason: \${decisionRemarks}\` : ''}\`,
          deepLink: '/mpd/zmcc-manager?tab=APPROVALS&view=MOT_EXCEPTIONS',
          dedupeSuffix: \`\${collection.id}:\${clientEventId}\`,
        });
      }`;

const motReplacement = `      if (decision.route === 'SEND_TO_APPROVER') {
        await createNotificationsForEvent(tx, {
          eventKey: 'MOT_SHOP_EXCEPTION_PENDING',
          sourceId: collection.id.toString(),
          sourceZmccId: stop.journey.zmcc_id,
          title: 'Shop milk needs your decision',
          body: \`Shop \${stop.shop_name_snapshot} (\${stop.shop_code_snapshot}): \${decision.exceptionReasons.join(', ')}. MOT said \${personDecision === 'ACCEPT' ? 'accept' : 'reject'}.\${decisionRemarks ? \` Reason: \${decisionRemarks}\` : ''}\`,
          deepLink: '/mpd/zmcc-manager?tab=APPROVALS&view=MOT_EXCEPTIONS',
          dedupeSuffix: \`\${collection.id}:\${clientEventId}\`,
        });
      } else if (decisionDetails.warnings && decisionDetails.warnings.length > 0) {
        // Warning tolerance: Non-blocking advisory notification to ZMCC Manager and Head of MPD
        await createNotificationsForEvent(tx, {
          eventKey: 'MOT_SHOP_WARNING_LOGGED',
          sourceId: collection.id.toString(),
          sourceZmccId: stop.journey.zmcc_id,
          title: \`Shop warning accepted: \${stop.shop_name_snapshot}\`,
          body: \`Shop \${stop.shop_name_snapshot} (\${stop.shop_code_snapshot}): \${decisionDetails.warnings.join('; ')}. Accepted by \${stop.journey.mot_profile.name}.\${decisionRemarks ? \` Remarks: \${decisionRemarks}\` : ''}\`,
          deepLink: '/mpd/zmcc-manager?tab=COLLECTIONS',
          dedupeSuffix: \`\${collection.id}:warning:\${clientEventId}\`,
        });
      }`;

if (motCore.replace(/\r\n/g, '\n').includes(motTarget.replace(/\r\n/g, '\n'))) {
  motCore = motCore.replace(
    motCore.includes('\r\n') ? motTarget.replace(/\n/g, '\r\n') : motTarget,
    motCore.includes('\r\n') ? motReplacement.replace(/\n/g, '\r\n') : motReplacement
  );
  fs.writeFileSync(motCorePath, motCore, 'utf8');
  console.log('Successfully patched motCore.ts');
} else {
  console.error('Target not found in motCore.ts');
}

// 2. Patch zmccLabService.ts
const zmccLabPath = 'src/backend/services/zmccLabService.ts';
let zmccLab = fs.readFileSync(zmccLabPath, 'utf8');

const zmccTarget = `      if (decision.route === 'SEND_TO_APPROVER') {
        await createNotificationsForEvent(tx, {
          eventKey: 'ZMCC_LAB_EXCEPTION_PENDING',
          sourceId: portionId.toString(),
          sourceZmccId: portion.lab_session.zmcc_id,
          title: 'Lab portion needs your decision',
          body: \`Portion \${portion.portion_number} (session #\${sessionId}): \${decision.exceptionReasons.join(', ')}. Lab said \${personDecision === 'ACCEPT' ? 'accept' : 'reject'}.\${remarks ? \` Reason: \${remarks}\` : ''}\`,
          deepLink: '/mpd/zmcc-manager?tab=APPROVALS&view=LAB_EXCEPTIONS',
          dedupeSuffix: \`portion:\${portionId}:v\${version}\`,
        });
      }`;

const zmccReplacement = `      if (decision.route === 'SEND_TO_APPROVER') {
        await createNotificationsForEvent(tx, {
          eventKey: 'ZMCC_LAB_EXCEPTION_PENDING',
          sourceId: portionId.toString(),
          sourceZmccId: portion.lab_session.zmcc_id,
          title: 'Lab portion needs your decision',
          body: \`Portion \${portion.portion_number} (session #\${sessionId}): \${decision.exceptionReasons.join(', ')}. Lab said \${personDecision === 'ACCEPT' ? 'accept' : 'reject'}.\${remarks ? \` Reason: \${remarks}\` : ''}\`,
          deepLink: '/mpd/zmcc-manager?tab=APPROVALS&view=LAB_EXCEPTIONS',
          dedupeSuffix: \`portion:\${portionId}:v\${version}\`,
        });
      } else if (details.warnings && details.warnings.length > 0) {
        // Warning tolerance: Non-blocking advisory notification to ZMCC Manager and Head of MPD
        await createNotificationsForEvent(tx, {
          eventKey: 'ZMCC_LAB_WARNING_LOGGED',
          sourceId: portionId.toString(),
          sourceZmccId: portion.lab_session.zmcc_id,
          title: \`Lab warning accepted: Portion \${portion.portion_number}\`,
          body: \`Session #\${sessionId} portion \${portion.portion_number}: \${details.warnings.join('; ')}. Accepted by \${auth.acting.performedAsRole || auth.actorRole}.\${remarks ? \` Remarks: \${remarks}\` : ''}\`,
          deepLink: '/zmcc/lab?tab=history',
          dedupeSuffix: \`portion-warning:\${portionId}:v\${version}\`,
        });
      }`;

if (zmccLab.replace(/\r\n/g, '\n').includes(zmccTarget.replace(/\r\n/g, '\n'))) {
  zmccLab = zmccLab.replace(
    zmccLab.includes('\r\n') ? zmccTarget.replace(/\n/g, '\r\n') : zmccTarget,
    zmccLab.includes('\r\n') ? zmccReplacement.replace(/\n/g, '\r\n') : zmccReplacement
  );
  fs.writeFileSync(zmccLabPath, zmccLab, 'utf8');
  console.log('Successfully patched zmccLabService.ts');
} else {
  console.error('Target not found in zmccLabService.ts');
}

// 3. Patch complete/route.ts (Plant QA)
const plantQaPath = 'src/app/api/qa/vehicle-visits/[visitId]/portions/[portionId]/complete/route.ts';
let plantQa = fs.readFileSync(plantQaPath, 'utf8');

const plantTarget = `        if (session) {
          await tx.qATestingSessionEvent.create({
            data: {
              session_id: session.id,
              event_type: finalPlantDecision === 'ACCEPTED' ? 'PORTION_ACCEPTED' : 'PORTION_REJECTED',
              timestamp: targetOpTs,
              user_id: userIdBigInt,
              note: \`Portion #\${lockedPortion.portion_number} \${finalPlantDecision}: \${rejectionReasonInput || exceptionReasonsList.join(', ') || systemQualityOutcome}\`,
            },
          });
        }`;

const plantReplacement = `        if (session) {
          await tx.qATestingSessionEvent.create({
            data: {
              session_id: session.id,
              event_type: finalPlantDecision === 'ACCEPTED' ? 'PORTION_ACCEPTED' : 'PORTION_REJECTED',
              timestamp: targetOpTs,
              user_id: userIdBigInt,
              note: \`Portion #\${lockedPortion.portion_number} \${finalPlantDecision}: \${rejectionReasonInput || exceptionReasonsList.join(', ') || systemQualityOutcome}\`,
            },
          });
        }

        if (hasWarning) {
          // Warning notification to AVP QA Reception Lab / QA Head
          await createNotificationsForEvent(tx, {
            eventKey: 'PLANT_QA_WARNING_LOGGED',
            sourceId: portionId.toString(),
            title: \`Plant QA warning accepted: \${portion.visit.vehicle_number}\`,
            body: \`Vehicle \${portion.visit.vehicle_number} portion #\${lockedPortion.portion_number}: \${warningTestCodes.join(', ')} in warning tolerance margin. Accepted by \${effectiveRole}.\${rejectionReasonInput ? \` Remarks: \${rejectionReasonInput}\` : ''}\`,
            deepLink: '/department/qa-head',
            dedupeSuffix: \`qa-warning:\${portionId}:\${completionEventId}\`,
          });
        }`;

if (plantQa.replace(/\r\n/g, '\n').includes(plantTarget.replace(/\r\n/g, '\n'))) {
  plantQa = plantQa.replace(
    plantQa.includes('\r\n') ? plantTarget.replace(/\n/g, '\r\n') : plantTarget,
    plantQa.includes('\r\n') ? plantReplacement.replace(/\n/g, '\r\n') : plantReplacement
  );
  fs.writeFileSync(plantQaPath, plantQa, 'utf8');
  console.log('Successfully patched complete/route.ts');
} else {
  console.error('Target not found in complete/route.ts');
}
