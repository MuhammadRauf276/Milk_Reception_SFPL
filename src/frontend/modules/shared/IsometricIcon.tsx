'use client';

import React from 'react';
import { Truck, KeyRound, TestTube2, Scale, Factory } from 'lucide-react';

interface IsometricIconProps {
  type: 'truck' | 'badge' | 'flask' | 'scale' | 'tank';
  size?: 'sm' | 'md' | 'lg';
}

export const IsometricIcon: React.FC<IsometricIconProps> = ({ type, size = 'md' }) => {
  const sizeClasses = {
    sm: 'w-8 h-8 p-1.5',
    md: 'w-10 h-10 p-2',
    lg: 'w-12 h-12 p-2.5',
  }[size];

  const iconSizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-5 h-5',
    lg: 'w-6 h-6',
  }[size];

  const renderIcon = () => {
    switch (type) {
      case 'truck':
        return <Truck className={`${iconSizeClasses} text-white drop-shadow`} />;
      case 'badge':
        return <KeyRound className={`${iconSizeClasses} text-white drop-shadow`} />;
      case 'flask':
        return <TestTube2 className={`${iconSizeClasses} text-white drop-shadow`} />;
      case 'scale':
        return <Scale className={`${iconSizeClasses} text-white drop-shadow`} />;
      case 'tank':
        return <Factory className={`${iconSizeClasses} text-white drop-shadow`} />;
    }
  };

  const bgGradientClasses = {
    truck: 'bg-gradient-to-tr from-blue-700 via-blue-600 to-sky-500 shadow-blue-500/20 border-blue-400/40',
    badge: 'bg-gradient-to-tr from-amber-700 via-amber-600 to-yellow-500 shadow-amber-500/20 border-amber-400/40',
    flask: 'bg-gradient-to-tr from-purple-800 via-purple-600 to-fuchsia-500 shadow-purple-500/20 border-purple-400/40',
    scale: 'bg-gradient-to-tr from-indigo-800 via-indigo-600 to-blue-500 shadow-indigo-500/20 border-indigo-400/40',
    tank: 'bg-gradient-to-tr from-emerald-800 via-emerald-600 to-teal-500 shadow-emerald-500/20 border-emerald-400/40',
  }[type];

  return (
    <div
      className={`relative inline-flex items-center justify-center rounded-xl border ${bgGradientClasses} ${sizeClasses} shadow-md backdrop-blur-md transition-all duration-300 hover:scale-105 hover:-rotate-3`}
    >
      <div className="absolute inset-0 bg-white/10 rounded-xl pointer-events-none" />
      {renderIcon()}
    </div>
  );
};
