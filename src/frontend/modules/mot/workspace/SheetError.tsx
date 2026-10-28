import React from 'react';
import { AlertTriangle } from 'lucide-react';

export function SheetError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="bg-card border-border flex items-start gap-2 rounded-xl border p-3 text-xs font-semibold text-rose-800">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
