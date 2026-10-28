'use client';

import React from 'react';
import { Camera, CheckCircle2, Trash2 } from 'lucide-react';
import { LiveCamera, type LiveCameraProps } from '@/components/camera/LiveCamera';
import { toPhotoState, type DispatchPhotoState } from './DispatchPolicyTests';

export interface LabReportPhotoCardProps {
  photo: DispatchPhotoState | null;
  onPhotoChange: (photo: DispatchPhotoState | null) => void;
  cameraOpen: boolean;
  onCameraOpenChange: (open: boolean) => void;
  stamp: LiveCameraProps['stamp'];
}

/** Paper lab report photo required for a dispatch record. */
export const LabReportPhotoCard: React.FC<LabReportPhotoCardProps> = ({
  photo: labReportPhoto,
  onPhotoChange: setLabReportPhoto,
  cameraOpen: labReportCamera,
  onCameraOpenChange: setLabReportCamera,
  stamp,
}) => {
  return (
          <div className="p-4 sm:p-5 rounded-xl bg-card border border-border-strong shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-semibold text-foreground">Lab report photo</h4>
              </div>
              {labReportPhoto && (
                <button
                  type="button"
                  onClick={() => {
                    if (labReportPhoto) URL.revokeObjectURL(labReportPhoto.previewUrl);
                    setLabReportPhoto(null);
                  }}
                  className="min-h-11 min-w-11 text-xs text-rose-600 hover:text-rose-800 flex items-center space-x-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Retake</span>
                </button>
              )}
            </div>

            {labReportPhoto ? (
              <div className="bg-card border-border flex items-center space-x-3 p-2.5 rounded-xl border">
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
                  <div className="text-[11px] text-emerald-700 mt-0.5">
                    {new Date(labReportPhoto.capturedAt).toLocaleTimeString()}
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
                className="w-full min-h-[48px] px-4 py-2.5 rounded-xl border border-dashed border-border-strong hover:border-primary-hover bg-slate-50 hover:bg-blue-50/50 text-xs font-semibold text-slate-700 flex items-center justify-center space-x-2 transition"
              >
                <Camera className="w-4 h-4 text-primary-hover" />
                <span>Take Hand-written Lab Report Photo</span>
              </button>
            )}
          </div>
  );
};
