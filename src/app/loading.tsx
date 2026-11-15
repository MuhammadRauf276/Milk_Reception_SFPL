import { PageLoader } from '@/components/ui/spinner';

export default function GlobalLoading() {
  return <PageLoader label="Loading workspace…" className="min-h-dvh" />;
}
