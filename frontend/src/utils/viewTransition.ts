/**
 * Utility functions for CSS View Transitions API (W3C standard).
 *
 * Provides smooth transitions when items are updated, moved, or completed
 * without blocking state changes or introducing perceptual latency.
 */

/**
 * Return a valid, sanitized CSS `<custom-ident>` for an issue's view-transition-name.
 *
 * Active issues get `issue-<sanitized-key>`, while completed issues get
 * `issue-done-<sanitized-key>`. Having distinct transition names allows the
 * active card to animate its exit/fade-out in place while siblings smoothly slide
 * up into the vacated slot.
 */
export function getViewTransitionName(issueKey: string, isDone = false): string {
  const sanitized = issueKey.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  return isDone ? `issue-done-${sanitized}` : `issue-${sanitized}`;
}

/**
 * Executes a state-mutating callback within a document view transition if supported,
 * or immediately as a zero-latency fallback.
 */
export function runWithViewTransition(callback: () => void): void {
  if (
    typeof document !== 'undefined' &&
    'startViewTransition' in document &&
    typeof (document as Document & { startViewTransition?: unknown }).startViewTransition === 'function'
  ) {
    (document as Document & { startViewTransition: (cb: () => void) => unknown }).startViewTransition(callback);
  } else {
    callback();
  }
}
