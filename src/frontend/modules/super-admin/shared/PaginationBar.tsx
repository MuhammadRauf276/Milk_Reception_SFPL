'use client';

import React from 'react';
import { Pagination, type PaginationProps } from '@/components/ui/pagination';

/** The shared pager inside a bordered panel. */
export function PaginationBar(props: PaginationProps) {
  return <Pagination {...props} className="border-t border-border bg-card" />;
}
