'use client';

import React from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { syncAll } from '@/frontend/modules/mot/offlineStore';
import { getLogoutSafety } from '@/frontend/modules/auth/logout';
import { runSyncOnce } from '@/frontend/modules/pwa/syncEngine';
import { logDeviceEvent } from '@/frontend/modules/pwa/diary';

export interface UnsentWorkLogoutDialogProps {
  /** Items waiting to be sent. */
  count: number;
  sendableCount?: number;
  draftsCount?: number;
  /** Items that need help from the office. They are kept, never deleted. */
  needsAttention?: number;
  isMot?: boolean;
  /** Called when everything was sent and logout can go on. */
  onAllSent: () => void;
  onKeepAndLogout: () => void;
  onClose: () => void;
}

/** Shown on logout when work is saved on the phone but not sent. There is no delete option. */
export function UnsentWorkLogoutDialog({
  count,
  sendableCount = 0,
  draftsCount = 0,
  needsAttention = 0,
  isMot = false,
  onAllSent,
  onKeepAndLogout,
  onClose,
}: UnsentWorkLogoutDialogProps) {
  const [waiting, setWaiting] = React.useState(count);
  const [help, setHelp] = React.useState(needsAttention);
  const [sending, setSending] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    // Black box: someone tried to log out while work was still on the phone.
    void logDeviceEvent('LOGOUT_ATTEMPT', { waiting: count, needsAttention });
    // Only on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSendNow = async () => {
    setSending(true);
    setMessage(null);
    try {
      // Both queues: old MOT queues, then the new offline sync queue (record + photos).
      await syncAll();
      await runSyncOnce();
    } catch {
      // Result is judged by re-checking what is left.
    }
    const left = await getLogoutSafety({ isMot });
    setSending(false);
    setWaiting(left.total);
    setHelp(left.needsAttention);
    if (left.sendableCount === 0) {
      setMessage('Sent');
      onAllSent();
    } else {
      setMessage('Could not send. Your work is still safe on this device.');
    }
  };

  const body = `${waiting} ${waiting === 1 ? 'item is' : 'items are'} saved locally on this device but not sent to the server yet.`;

  return (
    <Modal onClose={onClose} title="Work not sent yet" description={body} size="sm" closeOnOutsideClick={!sending} preventClose={sending}>
      <div className="space-y-4 p-5">
        <div className="space-y-2">
          <h2 className="text-lg font-semibold leading-tight">Work not sent yet</h2>
          <p className="text-base text-muted-foreground">{body}</p>
          {help > 0 ? (
            <p className="text-base text-muted-foreground">
              {help} {help === 1 ? 'item needs' : 'items need'} help from the office.
            </p>
          ) : null}
          {message ? (
            <p role="status" className="text-base font-medium">
              {message}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-3">
          <Button type="button" className="h-14 min-h-[44px] w-full text-base font-semibold" disabled={sending} onClick={() => void handleSendNow()}>
            {sending ? 'Sending…' : 'Send now & Log out'}
          </Button>
          <Button type="button" variant="outline" className="h-12 min-h-[44px] w-full text-base" disabled={sending} onClick={onKeepAndLogout}>
            Keep on device & Log out for next shift
          </Button>
        </div>
      </div>
    </Modal>
  );
}
