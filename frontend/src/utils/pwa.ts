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
    });
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
