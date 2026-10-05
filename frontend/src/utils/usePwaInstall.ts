import { useEffect, useState, useCallback } from 'react';
import {
  type BeforeInstallPromptEvent,
  isAndroidDevice,
  isIOSDevice,
  isRunningStandalone,
} from './pwa.ts';

export interface PwaInstallState {
  canInstall: boolean;
  isInstallable: boolean;
  isInstalled: boolean;
  isStandalone: boolean;
  isAndroid: boolean;
  isIOS: boolean;
  showHelpModal: boolean;
  triggerInstall: () => Promise<'accepted' | 'dismissed' | 'manual'>;
  openHelpModal: () => void;
  closeHelpModal: () => void;
}

export function usePwaInstall(): PwaInstallState {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState<boolean>(false);
  const [isStandalone, setIsStandalone] = useState<boolean>(false);
  const [showHelpModal, setShowHelpModal] = useState<boolean>(false);

  const isAndroid = typeof window !== 'undefined' ? isAndroidDevice() : false;
  const isIOS = typeof window !== 'undefined' ? isIOSDevice() : false;

  useEffect(() => {
    setIsStandalone(isRunningStandalone());

    const handleBeforeInstallPrompt = (event: Event) => {
      // Prevent automatic browser banner so we can provide a cohesive in-app experience
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      setShowHelpModal(false);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const triggerInstall = useCallback(async (): Promise<'accepted' | 'dismissed' | 'manual'> => {
    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        if (choice.outcome === 'accepted') {
          setIsInstalled(true);
          setDeferredPrompt(null);
        }
        return choice.outcome;
      } catch (err) {
        console.warn('[PWA] Error triggering install prompt:', err);
      }
    }

    // If native prompt is not directly available (e.g. iOS or manual install flow)
    setShowHelpModal(true);
    return 'manual';
  }, [deferredPrompt]);

  const openHelpModal = useCallback(() => setShowHelpModal(true), []);
  const closeHelpModal = useCallback(() => setShowHelpModal(false), []);

  const canInstall = !isStandalone && !isInstalled;
  const isInstallable = Boolean(deferredPrompt);

  return {
    canInstall,
    isInstallable,
    isInstalled,
    isStandalone,
    isAndroid,
    isIOS,
    showHelpModal,
    triggerInstall,
    openHelpModal,
    closeHelpModal,
  };
}
