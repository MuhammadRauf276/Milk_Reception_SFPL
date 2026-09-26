import { NextResponse } from 'next/server';
import { prisma } from '@core/db';

// This route should be pinged by a Vercel Cron Job or AWS EventBridge every minute
export async function GET(req: Request) {
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
      return NextResponse.json({ message: 'No pending SMS messages found.' });
    }

    const processedIds: bigint[] = [];
    const failedIds: bigint[] = [];

    // 2. Process each message
    for (const msg of pendingMessages) {
      try {
        // TODO: Replace with actual Twilio / AWS SNS API call
        // const response = await smsProvider.send({ to: msg.recipient_phone, body: msg.message_body });
        
        // Mocking a successful send for now:
        const isSuccess = true; 

        if (isSuccess) {
          await prisma.motCollectionSmsOutbox.update({
            where: { id: msg.id },
            data: {
              status: 'SENT',
              sent_at: new Date(),
              provider_message_id: `mock-id-${Date.now()}`,
              attempt_count: { increment: 1 },
            },
          });
          processedIds.push(msg.id);
        } else {
          throw new Error('Provider API rejected the message.');
        }
      } catch (error: any) {
        await prisma.motCollectionSmsOutbox.update({
          where: { id: msg.id },
          data: {
            status: msg.attempt_count >= 2 ? 'FAILED' : 'PENDING',
            last_error: error.message,
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
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
