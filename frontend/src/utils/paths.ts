/**
 * Path and URL utilities supporting both standalone and Home Assistant Ingress dynamic proxying.
 */

/**
 * Returns the base path prefix for API and asset routing.
 * When running inside Home Assistant Ingress, the URL starts with /api/hassio_ingress/<token>/.
 */
export function getBasePath(): string {
  if (typeof window === 'undefined') return '';
  const pathname = window.location.pathname;
  const ingressMatch = pathname.match(/^(\/api\/hassio_ingress\/[^/]+)/);
  if (ingressMatch) {
    return ingressMatch[1];
  }
  return '';
}

/**
 * Returns a properly prefixed API URL.
 */
export function getApiUrl(endpoint: string): string {
  const base = getBasePath();
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${base}${cleanEndpoint}`;
}

/**
 * Returns a properly prefixed WebSocket URL.
 */
export function getWsUrl(): string {
  if (typeof window === 'undefined') return 'ws://localhost:8000/ws';
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const base = getBasePath();
  return `${protocol}//${window.location.host}${base}/ws`;
}
