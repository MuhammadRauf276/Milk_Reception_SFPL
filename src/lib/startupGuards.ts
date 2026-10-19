/**
 * Startup safety checks. Each check throws a clear error when the app is
 * configured in a way that is unsafe for production.
 */

export const DEV_LOGIN_PROFILES_FLAG = 'NEXT_PUBLIC_ENABLE_DEV_LOGIN_PROFILES';

/**
 * Throws if dev login profiles are switched on while NODE_ENV is 'production'.
 * Dev login uses known, shared passwords, so it must never run in production.
 */
export function assertProductionSafety(): void {
  if (process.env.NODE_ENV === 'production' && process.env[DEV_LOGIN_PROFILES_FLAG] === 'true') {
    throw new Error(
      `Unsafe configuration: ${DEV_LOGIN_PROFILES_FLAG} is 'true' while NODE_ENV is 'production'. ` +
        'Set it to false or remove it before starting the app in production.',
    );
  }
}
