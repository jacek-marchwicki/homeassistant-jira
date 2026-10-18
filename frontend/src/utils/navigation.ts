/**
 * URL-based navigation helpers.
 *
 * Every navigable state of the dashboard (board / backlog / people views, an open task,
 * the create-issue dialog) maps to a URL so the browser back/forward buttons work.
 * All paths are resolved relative to the dynamic base path (Home Assistant Ingress prefix).
 */
import { getBasePath } from './paths.ts';

export type RouteView = 'board' | 'backlog' | 'people';

export type Route =
  | { kind: 'view'; view: RouteView }
  | { kind: 'task'; key: string }
  | { kind: 'create' }
  | { kind: 'status' }
  | { kind: 'root' };

const VIEWS: RouteView[] = ['board', 'backlog', 'people'];

/** history.state marker identifying entries pushed by the app itself. */
const NAV_STATE_MARKER = 'appNav';

/** Strips the dynamic base path (Ingress prefix) from a pathname. */
export function stripBasePath(pathname: string, base: string = getBasePath()): string {
  if (base && pathname.startsWith(base)) {
    return pathname.slice(base.length) || '/';
  }
  return pathname || '/';
}

/** Parses a pathname (without base path) into a route. Unknown paths resolve to `root`. */
export function parseRoute(pathname: string): Route {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return { kind: 'root' };
  const [first, second] = segments;
  if (first === 'task' && second) {
    try {
      return { kind: 'task', key: decodeURIComponent(second) };
    } catch {
      return { kind: 'root' };
    }
  }
  if (first === 'create' && segments.length === 1) return { kind: 'create' };
  if (first === 'status' && segments.length === 1) return { kind: 'status' };
  if (segments.length === 1 && (VIEWS as string[]).includes(first)) {
    return { kind: 'view', view: first as RouteView };
  }
  return { kind: 'root' };
}

/** Builds a path (without base path) for a route. */
export function buildPath(route: Route): string {
  switch (route.kind) {
    case 'view':
      return `/${route.view}`;
    case 'task':
      return `/task/${encodeURIComponent(route.key)}`;
    case 'create':
      return '/create';
    case 'status':
      return '/status';
    default:
      return '/';
  }
}

/** Parses the current browser location into a route. */
export function getCurrentRoute(): Route {
  if (typeof window === 'undefined') return { kind: 'root' };
  return parseRoute(stripBasePath(window.location.pathname));
}

function fullPath(route: Route): string {
  return `${getBasePath()}${buildPath(route)}`;
}

function currentFullPath(): string {
  return typeof window === 'undefined' ? '' : window.location.pathname;
}

/** Pushes a new history entry for the route (no-op if it is already the current URL). */
export function pushRoute(route: Route): void {
  if (typeof window === 'undefined') return;
  const target = fullPath(route);
  if (currentFullPath() === target) return;
  window.history.pushState({ [NAV_STATE_MARKER]: true }, '', target);
}

/** Replaces the current history entry with the route. */
export function replaceRoute(route: Route): void {
  if (typeof window === 'undefined') return;
  const target = fullPath(route);
  if (currentFullPath() === target) return;
  window.history.replaceState(window.history.state, '', target);
}

/**
 * Leaves an overlay route (task / create). If the overlay was opened from within the app
 * we go back one entry so history does not grow; otherwise (deep link) we replace the URL.
 */
export function closeOverlayRoute(fallback: Route): void {
  if (typeof window === 'undefined') return;
  const state = window.history.state as Record<string, unknown> | null;
  if (state && state[NAV_STATE_MARKER]) {
    window.history.back();
  } else {
    replaceRoute(fallback);
  }
}
