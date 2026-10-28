'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface StatusScreenProps {
  icon: React.ReactNode;
  tone?: 'neutral' | 'warning' | 'danger';
  title: string;
  description: React.ReactNode;
  children?: React.ReactNode;
}

const TONES = {
  neutral: 'bg-muted text-muted-foreground',
  warning: 'bg-amber-50 text-amber-600',
  danger: 'bg-red-50 text-red-600',
};

/** Centered full-page message for errors, 404s and access problems. */
export function StatusScreen({ icon, tone = 'neutral', title, description, children }: StatusScreenProps) {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background p-6">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="w-full max-w-md rounded-xl border bg-card p-8 text-center shadow-2xs"
      >
        <div className={cn('mx-auto mb-5 flex h-11 w-11 items-center justify-center rounded-full [&_svg]:h-5 [&_svg]:w-5', TONES[tone])}>
          {icon}
        </div>
        <h1 className="text-lg font-semibold tracking-tight text-foreground">{title}</h1>
        <div className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</div>
        {children ? <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">{children}</div> : null}
      </motion.div>
    </div>
  );
}
