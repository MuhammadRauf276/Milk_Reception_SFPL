/**
 * Lifecycle of the "session expired while offline" banner.
 * Pure state machine so it can be tested without a browser.
 */

/** How long the banner stays before it hides itself, in milliseconds. */
export const AUTH_BANNER_AUTO_DISMISS_MS = 6000;

export interface AuthBannerState {
  visible: boolean;
}

export type AuthBannerEvent =
  /** A 401 was seen. `online` is the connection state at that moment. */
  | { type: 'EXPIRED'; online: boolean }
  | { type: 'DISMISSED' }
  | { type: 'TIMEOUT' }
  /** User signed in again (re-auth modal or login page). */
  | { type: 'SIGNED_IN' }
  /** Connection returned and /api/auth/me confirmed a valid session. */
  | { type: 'ONLINE_SESSION_VALID' };

export const INITIAL_AUTH_BANNER_STATE: AuthBannerState = { visible: false };

export function authBannerReducer(state: AuthBannerState, event: AuthBannerEvent): AuthBannerState {
  switch (event.type) {
    case 'EXPIRED':
      // Online: the normal sign-in prompt handles it, this banner would be wrong.
      return event.online ? state : { visible: true };
    case 'DISMISSED':
    case 'TIMEOUT':
    case 'SIGNED_IN':
    case 'ONLINE_SESSION_VALID':
      return state.visible ? { visible: false } : state;
    default:
      return state;
  }
}
