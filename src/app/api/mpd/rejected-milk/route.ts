import { getRejectedMilkQueue } from '@/backend/services/rejectedMilkDispositionService';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return getRejectedMilkQueue(req);
}
