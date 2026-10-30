import React from 'react';
import { LoginPage } from '@modules/auth/LoginPage';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function LoginRoutePage() {
  return <LoginPage />;
}

