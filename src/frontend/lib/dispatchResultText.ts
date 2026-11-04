import type { PortionLabTestResult } from '@backend/core/types';

/**
 * What a Dispatch cell says for one test. A value always wins. Without one, a test marked as not
 * performed says so with its reason, and "Not recorded" is kept for a test with no result at all.
 */
export function dispatchResultText(result: PortionLabTestResult): string {
  if (result.dispatch_numeric_value != null) return `${result.dispatch_numeric_value}`;
  if (result.dispatch_text_value != null && result.dispatch_text_value !== '') return result.dispatch_text_value;
  if (result.dispatch_performed) return 'Recorded';
  if (result.dispatch_marked_not_performed) {
    const reason = result.dispatch_not_performed_reason?.trim();
    if (!reason) return 'Not performed';
    // Some saved reasons already say it, such as "Not performed at dispatch".
    return /^not performed/i.test(reason) ? reason : `Not performed: ${reason}`;
  }
  return 'Not recorded';
}
