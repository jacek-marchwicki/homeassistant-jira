import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  registerServiceWorker,
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
    it('registers sw.js with relative scope when supported', async () => {
      const mockRegister = vi.fn().mockResolvedValue({
        scope: './',
      } as ServiceWorkerRegistration);

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
      expect(mockRegister).toHaveBeenCalledWith('./sw.js', { scope: './' });
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
