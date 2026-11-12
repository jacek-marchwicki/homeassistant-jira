import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Service Worker (frontend/public/sw.js)', () => {
  const swPath = path.resolve(__dirname, '../../public/sw.js');
  let swCode: string;

  beforeEach(() => {
    swCode = fs.readFileSync(swPath, 'utf-8');
  });

  it('contains expected precache assets including root shell and manifest', () => {
    expect(swCode).toContain("'./'");
    expect(swCode).toContain("'./manifest.webmanifest'");
    expect(swCode).toContain("'./favicon.svg'");
    expect(swCode).toContain("'./apple-touch-icon.png'");
  });

  it('bypasses non-GET, API calls (/api/) and WebSockets (/ws)', () => {
    expect(swCode).toContain("request.method !== 'GET'");
    expect(swCode).toContain("url.pathname.includes('/api/')");
    expect(swCode).toContain("url.pathname.includes('/ws')");
  });

  it('implements Stale-While-Revalidate for navigation/HTML requests for instant PWA loading', () => {
    // Verifies navigation requests do NOT use blocking network-first fetch({ cache: 'no-cache' })
    expect(swCode).not.toContain("fetch(request, { cache: 'no-cache' })");

    // Verifies caches.match is called first and returns cached HTML immediately
    expect(swCode).toContain("caches.match(request)");
    expect(swCode).toContain("caches.match('./')");
    expect(swCode).toContain("caches.match('/index.html')");
  });

  it('simulates navigation fetch event returning cached HTML immediately and updating cache in background', async () => {
    let respondWithPromise: Promise<Response> | null = null;
    const mockCache = {
      match: vi.fn(),
      put: vi.fn().mockResolvedValue(undefined),
      addAll: vi.fn().mockResolvedValue(undefined),
    };

    const cachedHtmlResponse = new Response('<html>cached shell</html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    });

    // Mock caches.match returning cached shell
    mockCache.match.mockImplementation((req: string | Request) => {
      if (typeof req === 'string' && (req === './' || req === '/index.html')) {
        return Promise.resolve(cachedHtmlResponse);
      }
      return Promise.resolve(undefined);
    });

    const mockCaches = {
      open: vi.fn().mockResolvedValue(mockCache),
      match: mockCache.match,
    };

    const networkHtmlResponse = new Response('<html>fresh shell</html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    });

    const mockFetch = vi.fn().mockResolvedValue(networkHtmlResponse);

    // Event listener collector
    const listeners: Record<string, (e: any) => void> = {};
    const fakeScope = {
      addEventListener: (type: string, fn: (e: any) => void) => {
        listeners[type] = fn;
      },
      caches: mockCaches,
      fetch: mockFetch,
      skipWaiting: vi.fn().mockResolvedValue(undefined),
      clients: { claim: vi.fn().mockResolvedValue(undefined) },
    };

    // Run sw.js in fake scope sandbox
    const swFunction = new Function('self', 'caches', 'fetch', swCode);
    swFunction(fakeScope, mockCaches, mockFetch);

    expect(listeners['fetch']).toBeDefined();

    // Create navigation request event
    const navRequest = {
      method: 'GET',
      url: 'https://example.com/app/task/HOME-1',
      mode: 'navigate',
    };

    const fetchEvent = {
      request: navRequest,
      respondWith: (p: Promise<Response>) => {
        respondWithPromise = p;
      },
    };

    listeners['fetch'](fetchEvent);

    expect(respondWithPromise).not.toBeNull();
    const servedResponse = await respondWithPromise!;

    // Must return the cached response immediately for instant shell startup
    expect(await servedResponse.text()).toBe('<html>cached shell</html>');

    // And background fetch must have been dispatched
    expect(mockFetch).toHaveBeenCalled();
  });
});
