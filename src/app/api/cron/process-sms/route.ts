import { NextResponse } from 'next/server';
import { prisma } from '@core/db';
import { getErrorMessage } from '@/lib/errors';
import { hasValidBearerSecret, requireRoles } from '@/backend/core/route-guards';

// Roles allowed to trigger the queue from the UI (same roles that can open the SMS outbox).
const SMS_DISPATCH_ROLES = ['SUPER_ADMIN', 'ZMCC_MANAGER', 'PHE_OPERATOR', 'MDO', 'DATA_EXECUTIVE'] as const;

export async function POST(req: Request) {
  return GET(req);
}

// This route should be pinged by a Vercel Cron Job, AWS EventBridge, or triggered from the UI
export async function GET(req: Request) {
  // Scheduler (CRON_SECRET bearer) or a logged-in user with an allowed role.
  if (!hasValidBearerSecret(req, 'CRON_SECRET')) {
    const guard = await requireRoles(req, SMS_DISPATCH_ROLES);
    if ('response' in guard) return guard.response;
  }

  try {
    // 1. Fetch up to 50 pending SMS messages
    const pendingMessages = await prisma.motCollectionSmsOutbox.findMany({
      where: {
        status: 'PENDING',
        attempt_count: { lt: 3 }, // Max 3 retry attempts
      },
      take: 50,
      orderBy: { created_at: 'asc' },
    });

    if (pendingMessages.length === 0) {
      return NextResponse.json({ message: 'No pending SMS messages found.', processed: 0, failed: 0 });
    }

    const processedIds: bigint[] = [];
    const failedIds: bigint[] = [];

    // Check Local WhatsApp Gateway (Option A)
    const gatewayUrl = process.env.WHATSAPP_GATEWAY_URL || 'http://127.0.0.1:3001';
    let isLocalGatewayConnected = false;
    try {
      const gwRes = await fetch(`${gatewayUrl}/status`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(1500),
      });
      if (gwRes.ok) {
        const gwData = await gwRes.json();
        isLocalGatewayConnected = gwData.status === 'CONNECTED';
      }
    } catch {
      isLocalGatewayConnected = false;
    }

    // Check Meta WhatsApp Cloud API or Twilio credentials
    const whatsappToken = process.env.WHATSAPP_CLOUD_API_TOKEN || process.env.WHATSAPP_TOKEN;
    const whatsappPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    const twilioSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioToken = process.env.TWILIO_AUTH_TOKEN;
    const twilioFrom = process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_WHATSAPP_NUMBER;

    // 2. Process each message
    for (const msg of pendingMessages) {
      try {
        let providerMessageId = `dev-dispatch-${Date.now()}-${msg.id}`;

        const rawDigits = msg.recipient_phone.replace(/\D/g, '');
        const intlPhone = rawDigits.startsWith('92')
          ? rawDigits
          : rawDigits.startsWith('0')
            ? `92${rawDigits.slice(1)}`
            : `92${rawDigits}`;

        // 1) Local QR Code WhatsApp Gateway (Option A)
        if (isLocalGatewayConnected) {
          const gwSendRes = await fetch(`${gatewayUrl}/send`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(process.env.WHATSAPP_GATEWAY_SECRET ? { 'x-gateway-secret': process.env.WHATSAPP_GATEWAY_SECRET } : {}),
            },
            body: JSON.stringify({
              to: intlPhone,
              message: msg.message_body,
            }),
          });

          if (!gwSendRes.ok) {
            const errData = await gwSendRes.json().catch(() => ({}));
            throw new Error(errData.error || `Local WhatsApp gateway dispatch failed with status ${gwSendRes.status}`);
          }

          const sendJson = await gwSendRes.json().catch(() => ({}));
          providerMessageId = sendJson.messageId || providerMessageId;
        }
        // 2) Meta WhatsApp Cloud API
        else if (whatsappToken && whatsappPhoneId) {
          const waRes = await fetch(`https://graph.facebook.com/v21.0/${whatsappPhoneId}/messages`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${whatsappToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              recipient_type: 'individual',
              to: intlPhone,
              type: 'text',
              text: { preview_url: false, body: msg.message_body },
            }),
          });

          if (!waRes.ok) {
            const errData = await waRes.json().catch(() => ({}));
            throw new Error(errData?.error?.message || `WhatsApp Cloud API dispatch failed with status ${waRes.status}`);
          }

          const resJson = await waRes.json().catch(() => ({}));
          providerMessageId = resJson?.messages?.[0]?.id || providerMessageId;
        }
        // 2) Optional Twilio SMS / WhatsApp
        else if (twilioSid && twilioToken && twilioFrom) {
          const formattedTo = `+${intlPhone}`;
          const twilioEndpoint = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`;
          const params = new URLSearchParams({
            To: formattedTo,
            From: twilioFrom,
            Body: msg.message_body,
          });

          const twilioRes = await fetch(twilioEndpoint, {
            method: 'POST',
            headers: {
              'Authorization': 'Basic ' + Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64'),
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: params.toString(),
          });

          if (!twilioRes.ok) {
            const errData = await twilioRes.json().catch(() => ({}));
            throw new Error(errData.message || `Twilio dispatch failed with status ${twilioRes.status}`);
          }

          const resJson = await twilioRes.json().catch(() => ({ sid: providerMessageId }));
          providerMessageId = resJson.sid || providerMessageId;
        }

        await prisma.motCollectionSmsOutbox.update({
          where: { id: msg.id },
          data: {
            status: 'SENT',
            sent_at: new Date(),
            provider_message_id: providerMessageId,
            attempt_count: { increment: 1 },
          },
        });
        processedIds.push(msg.id);
      } catch (error) {
        await prisma.motCollectionSmsOutbox.update({
          where: { id: msg.id },
          data: {
            status: msg.attempt_count >= 2 ? 'FAILED' : 'PENDING',
            last_error: getErrorMessage(error),
            attempt_count: { increment: 1 },
          },
        });
        failedIds.push(msg.id);
      }
    }

    return NextResponse.json({
      success: true,
      processed: processedIds.length,
      failed: failedIds.length,
    });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
