import { toast as sonner, type ExternalToast } from 'sonner';

const DEFAULT_MS = 4000;
const ERROR_MS = 6000;
/** Extra time past the toast's own duration before it is closed regardless. */
const GRACE_MS = 1500;

type Message = Parameters<typeof sonner.success>[0];

/**
 * Sonner pauses a toast's timer while the pointer is over the toast area. On a touch screen a tap counts as hover and
 * no "pointer left" ever follows, so a toast could stay until someone tapped elsewhere. This closes each toast on its
 * own clock as well. Every toast in the app goes through here; the close button still works.
 */
function timed(show: (message: Message, options?: ExternalToast) => string | number, fallbackMs: number) {
  return (message: Message, options?: ExternalToast) => {
    const duration = options?.duration ?? fallbackMs;
    const id = show(message, { ...options, duration });
    if (typeof window !== 'undefined' && Number.isFinite(duration)) {
      window.setTimeout(() => sonner.dismiss(id), duration + GRACE_MS);
    }
    return id;
  };
}

export const toast = {
  success: timed(sonner.success, DEFAULT_MS),
  info: timed(sonner.info, DEFAULT_MS),
  warning: timed(sonner.warning, DEFAULT_MS),
  error: timed(sonner.error, ERROR_MS),
  dismiss: sonner.dismiss,
};
