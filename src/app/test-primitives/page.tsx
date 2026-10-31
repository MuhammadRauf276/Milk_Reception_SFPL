import { notFound } from 'next/navigation';
import TestPrimitivesClient from './TestPrimitivesClient';

export default function TestPrimitivesPage() {
  // Test harness is only available during development, testing, or when explicitly enabled
  if (process.env.NODE_ENV === 'production' && process.env.ENABLE_TEST_HARNESS !== 'true') {
    notFound();
  }

  return <TestPrimitivesClient />;
}
