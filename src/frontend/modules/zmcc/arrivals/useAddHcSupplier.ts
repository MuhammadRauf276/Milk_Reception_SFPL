'use client';

import React, { useState } from 'react';
import { useToast } from '@/frontend/context/ToastContext';
import { getErrorMessage } from '@/lib/errors';
import type { HcSupplierRow } from './arrivalTypes';

/** Inline "Add HC Supplier" form state + submit. */
export function useAddHcSupplier(onCreated: (supplier: HcSupplierRow) => void) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [cnic, setCnic] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openDrawer = () => {
    setOpen(true);
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim() || !cnic.trim()) {
      setError('Supplier name, phone number, and CNIC are required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/zmcc/hc-suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim(),
          cnic: cnic.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to create HC supplier.');
      } else {
        const supplier = data.supplier;
        if (supplier.approval_status === 'PENDING_APPROVAL') {
          toast.showInfo(`HC "${supplier.name}" saved. It is waiting for Zonal Manager approval.`);
        } else {
          toast.showSuccess(`HC supplier "${supplier.name}" onboarded (${supplier.local_supplier_code})`);
        }
        setOpen(false);
        setName('');
        setPhone('');
        setCnic('');
        onCreated(supplier);
      }
    } catch (err) {
      setError(getErrorMessage(err) || 'An unexpected error occurred.');
    } finally {
      setSubmitting(false);
    }
  };

  return { open, setOpen, openDrawer, name, setName, phone, setPhone, cnic, setCnic, submitting, error, submit };
}
