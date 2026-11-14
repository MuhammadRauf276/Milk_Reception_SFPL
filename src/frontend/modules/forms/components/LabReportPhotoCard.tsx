'use client';

import { formatTime } from '@/lib/format';
import React from 'react';
import { Camera, CheckCircle2, Trash2 } from 'lucide-react';
import { LiveCamera, type LiveCameraProps } from '@/components/camera/LiveCamera';
import { toPhotoState, type DispatchPhotoState } from './DispatchPolicyTests';

export interface LabReportPhotoCardProps {
  photo: DispatchPhotoState | null;
  onPhotoChange: (photo: DispatchPhotoState | null) => void;
  cameraOpen: boolean;
  onCameraOpenChange: (open: boolean) => void;
  required?: boolean;
  stamp: LiveCameraProps['stamp'];
}

/** Paper lab report photo required for a dispatch record. */
export const LabReportPhotoCard: React.FC<LabReportPhotoCardProps> = ({
  photo: labReportPhoto,
  onPhotoChange: setLabReportPhoto,
  cameraOpen: labReportCamera,
  onCameraOpenChange: setLabReportCamera,
  required = true,
  stamp,
}) => {
  return (
          <div className="p-4 sm:p-5 rounded-2xl bg-card border border-border-strong shadow-xs space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-xs font-semibold text-foreground">Lab report photo</h4>
                {required && (
                  <span className="rounded-md bg-primary px-2 py-0.5 text-xs font-semibold text-white">
                    Required *
                  </span>
                )}
              </div>
              {labReportPhoto && (
                <button
                  type="button"
                  onClick={() => {
                    if (labReportPhoto) URL.revokeObjectURL(labReportPhoto.previewUrl);
                    setLabReportPhoto(null);
                  }}
                  className="min-h-11 min-w-11 px-2 rounded-lg text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-800 active:scale-95 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-rose-500 flex items-center space-x-1 transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Retake</span>
                </button>
              )}
            </div>

            {labReportPhoto ? (
              <div className="bg-card border-border flex items-center space-x-3 p-3 rounded-xl border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={labReportPhoto.previewUrl}
                  alt="Lab Report"
                  className="w-16 h-16 object-cover rounded-lg border border-emerald-300"
                />
                <div className="text-xs">
                  <div className="font-semibold text-emerald-900 flex items-center space-x-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Lab report photo captured</span>
                  </div>
                  <div className="text-xs text-emerald-700 mt-0.5">
                    {formatTime(labReportPhoto.capturedAt)}
                  </div>
                </div>
              </div>
            ) : labReportCamera ? (
              <LiveCamera
                stamp={{ ...stamp, pointLabel: `${stamp.pointLabel} - Lab Report` }}
                onCapture={(c) => {
                  setLabReportPhoto(toPhotoState(c));
                  setLabReportCamera(false);
                }}
                onCancel={() => setLabReportCamera(false)}
              />
            ) : (
              <button
                type="button"
                onClick={() => setLabReportCamera(true)}
                className="w-full min-h-[48px] px-4 py-2 rounded-xl border border-dashed border-action/30 hover:border-primary-hover bg-action-soft hover:bg-blue-50/50 text-xs font-semibold text-action flex items-center justify-center space-x-2 transition active:scale-[0.99] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action"
              >
                <Camera className="w-4 h-4 text-muted-foreground group-hover:text-foreground" />
                <span>Take Hand-written Lab Report Photo</span>
              </button>
            )}
          </div>
  );
};
