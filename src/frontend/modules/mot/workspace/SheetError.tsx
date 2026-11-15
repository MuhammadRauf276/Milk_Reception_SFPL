import React from 'react';
import { ErrorPopup } from '@/components/ui/error-popup';

/** A sheet's problem, shown as a popup. */
export function SheetError({ message }: { message: string | null }) {
  return <ErrorPopup message={message} />;
}
