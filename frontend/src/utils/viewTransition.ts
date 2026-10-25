/**
 * Utility functions for CSS View Transitions API (W3C standard).
 *
 * Provides smooth transitions when items are updated, moved, or completed
 * without blocking state changes or introducing perceptual latency.
 */

/**
 * Return a valid, sanitized CSS `<custom-ident>` for an issue's view-transition-name.
 *
 * Scopes the transition name to the issue key and optional column/container id so that
 * issues appearing in multiple people columns (e.g. unassigned or shared tasks)
 * do not produce duplicate view-transition-name identifiers, which causes the browser
 * to abort the ViewTransition with an InvalidStateError.
 */
export function getViewTransitionName(
  issueKey: string,
  isDone = false,
  columnId?: string
): string {
  const scopePrefix = columnId ? `${columnId}-` : '';
  const sanitized = `${scopePrefix}${issueKey}`
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-');
  return isDone ? `issue-done-${sanitized}` : `issue-${sanitized}`;
}

import { flushSync } from 'react-dom';

/**
 * Executes a state-mutating callback within a document view transition if supported,
 * or immediately as a zero-latency fallback.
 *
 * In React 18/19, state mutations must be wrapped in `flushSync` so that React
 * synchronously commits the DOM changes before the browser captures the "after" snapshot.
 * Without `flushSync`, React batches updates asynchronously and the browser takes a snapshot
 * of unchanged DOM, resulting in zero animation.
 */
export function runWithViewTransition(callback: () => void): void {
  if (
    typeof document !== 'undefined' &&
    'startViewTransition' in document &&
    typeof (document as Document & { startViewTransition?: unknown }).startViewTransition === 'function'
  ) {
    (document as Document & { startViewTransition: (cb: () => void) => unknown }).startViewTransition(() => {
      try {
        flushSync(() => {
          callback();
        });
      } catch {
        callback();
      }
    });
  } else {
    callback();
  }
}
