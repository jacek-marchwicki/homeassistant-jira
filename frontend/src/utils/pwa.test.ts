import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  registerServiceWorker,
  setupServiceWorkerUpdateChecks,
  isRunningStandalone,
  isAndroidDevice,
  isIOSDevice,
} from './pwa.ts';

describe('PWA Utilities', () => {
  const originalNavigator = window.navigator;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(window, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
  });

  describe('registerServiceWorker', () => {
    it('registers sw.js with relative scope and updateViaCache: none when supported', async () => {
      const mockRegister = vi.fn().mockResolvedValue({
        scope: './',
        update: vi.fn().mockResolvedValue(undefined),
      } as unknown as ServiceWorkerRegistration);

      Object.defineProperty(window, 'navigator', {
        value: {
          ...originalNavigator,
          serviceWorker: {
            register: mockRegister,
          },
        },
        writable: true,
        configurable: true,
      });

      const reg = await registerServiceWorker();
      expect(mockRegister).toHaveBeenCalledWith('./sw.js', {
        scope: './',
        updateViaCache: 'none',
      });
      expect(reg?.scope).toBe('./');
    });

    it('returns undefined gracefully when serviceWorker is not in navigator', async () => {
      Object.defineProperty(window, 'navigator', {
        value: {},
        writable: true,
        configurable: true,
      });

      const reg = await registerServiceWorker();
      expect(reg).toBeUndefined();
    });

    it('handles registration failure gracefully without throwing', async () => {
      const mockRegister = vi.fn().mockRejectedValue(new Error('SW failed'));

      Object.defineProperty(window, 'navigator', {
        value: {
          ...originalNavigator,
          serviceWorker: {
            register: mockRegister,
          },
        },
        writable: true,
        configurable: true,
      });

      const reg = await registerServiceWorker();
      expect(reg).toBeUndefined();
    });
  });

  describe('setupServiceWorkerUpdateChecks', () => {
    it('calls registration.update on visibilitychange when document is visible', () => {
      const mockUpdate = vi.fn().mockResolvedValue(undefined);
      const registration = { update: mockUpdate } as unknown as ServiceWorkerRegistration;

      const cleanup = setupServiceWorkerUpdateChecks(registration, 60000);

      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));

      expect(mockUpdate).toHaveBeenCalledTimes(1);
      cleanup();
    });

    it('does not call registration.update on visibilitychange when document is hidden', () => {
      const mockUpdate = vi.fn().mockResolvedValue(undefined);
      const registration = { update: mockUpdate } as unknown as ServiceWorkerRegistration;

      const cleanup = setupServiceWorkerUpdateChecks(registration, 60000);

      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));

      expect(mockUpdate).not.toHaveBeenCalled();
      cleanup();
    });

    it('periodically calls registration.update via timer', () => {
      vi.useFakeTimers();
      const mockUpdate = vi.fn().mockResolvedValue(undefined);
      const registration = { update: mockUpdate } as unknown as ServiceWorkerRegistration;

      const cleanup = setupServiceWorkerUpdateChecks(registration, 5000);

      vi.advanceTimersByTime(5000);
      expect(mockUpdate).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(5000);
      expect(mockUpdate).toHaveBeenCalledTimes(2);

      cleanup();
      vi.useRealTimers();
    });
  });

  describe('isRunningStandalone', () => {
    it('returns true when display-mode: standalone matches', () => {
      vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
        matches: query === '(display-mode: standalone)',
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      expect(isRunningStandalone()).toBe(true);
    });

    it('returns true when iOS navigator.standalone is true', () => {
      vi.spyOn(window, 'matchMedia').mockImplementation(() => ({
        matches: false,
        media: '',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      Object.defineProperty(window, 'navigator', {
        value: {
          ...originalNavigator,
          standalone: true,
        },
        writable: true,
        configurable: true,
      });

      expect(isRunningStandalone()).toBe(true);
    });

    it('returns false for regular browser mode', () => {
      vi.spyOn(window, 'matchMedia').mockImplementation(() => ({
        matches: false,
        media: '',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      Object.defineProperty(window, 'navigator', {
        value: {
          ...originalNavigator,
          standalone: false,
        },
        writable: true,
        configurable: true,
      });

      expect(isRunningStandalone()).toBe(false);
    });
  });

  describe('Device Detection', () => {
    it('detects Android devices correctly', () => {
      Object.defineProperty(window.navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36',
        configurable: true,
      });

      expect(isAndroidDevice()).toBe(true);
      expect(isIOSDevice()).toBe(false);
    });

    it('detects iOS devices correctly', () => {
      Object.defineProperty(window.navigator, 'userAgent', {
        value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
        configurable: true,
      });

      expect(isIOSDevice()).toBe(true);
      expect(isAndroidDevice()).toBe(false);
    });

    it('detects desktop devices correctly', () => {
      Object.defineProperty(window.navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
        configurable: true,
      });

      expect(isAndroidDevice()).toBe(false);
      expect(isIOSDevice()).toBe(false);
    });
  });
});
