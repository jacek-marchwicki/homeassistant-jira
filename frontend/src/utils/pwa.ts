/**
 * Progressive Web App (PWA) utilities and lifecycle handlers.
 * Supports standalone web app installation, Service Worker registration,
 * and Android/mobile installation prompts.
 */

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

/**
 * Sets up periodic and visibility-based background checks for Service Worker updates.
 * Useful for dashboards and wallboards left open across app version updates.
 */
export function setupServiceWorkerUpdateChecks(
  registration: ServiceWorkerRegistration,
  intervalMs = 3600000 // default: 1 hour
): () => void {
  if (typeof window === 'undefined') return () => {};

  const checkUpdate = () => {
    try {
      registration.update().catch((err) => {
        console.warn('[PWA] Service Worker update check failed:', err);
      });
    } catch {
      // Ignore synchronous registration errors
    }
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      checkUpdate();
    }
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);
  const intervalId = setInterval(checkUpdate, intervalMs);

  return () => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    clearInterval(intervalId);
  };
}

/**
 * Registers the PWA Service Worker relative to the current base path
 * (supporting both standalone deployment and Home Assistant Ingress dynamic proxying).
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | undefined> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return undefined;
  }

  try {
    const registration = await navigator.serviceWorker.register('./sw.js', {
      scope: './',
      updateViaCache: 'none',
    });
    setupServiceWorkerUpdateChecks(registration);
    return registration;
  } catch (err) {
    console.warn('[PWA] Service Worker registration failed:', err);
    return undefined;
  }
}

/**
 * Detects whether the app is currently running as an installed standalone PWA.
 */
export function isRunningStandalone(): boolean {
  if (typeof window === 'undefined') return false;

  const isStandaloneMedia =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches;

  const isIOSStandalone = (navigator as unknown as { standalone?: boolean }).standalone === true;

  return Boolean(isStandaloneMedia || isIOSStandalone);
}

/**
 * Checks if the current browser client is running on an Android device.
 */
export function isAndroidDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return /android/i.test(navigator.userAgent);
}

/**
 * Checks if the current browser client is running on iOS (Safari/WebKit).
 */
export function isIOSDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}
