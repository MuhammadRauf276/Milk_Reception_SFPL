import type { Metadata } from 'next';
import { DeviceSetupScreen } from '@/frontend/modules/pwa/DeviceSetupScreen';

export const metadata: Metadata = { title: 'Phone setup' };

export default function DeviceSetupPage() {
  return <DeviceSetupScreen />;
}
