import { addRejectedMilkRemarks } from '@/backend/services/rejectedMilkDispositionService';

export async function POST(req: Request) {
  return addRejectedMilkRemarks(req);
}
