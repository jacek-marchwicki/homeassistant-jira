import React, { useState, useEffect } from 'react';
import { isRunningStandalone } from './pwa.ts';

export interface MobileViewportState {
  isMobile: boolean;
  keyboardOpen: boolean;
  isStandalone: boolean;
  viewportHeight: number | undefined;
  viewportOffsetTop: number | undefined;
}

/**
 * Hook to track mobile layout and visual viewport metrics (especially virtual keyboard appearance),
 * including in standalone PWA mode.
 *
 * On mobile and PWA devices, opening the software keyboard shrinks `window.visualViewport.height`.
 * This hook allows full-screen modals to constrain their height to the visible area
 * and position their bottom edge above the keyboard, enabling complete scrollability.
 * It also locks body scrolling while modals are active to prevent background jumping and
 * resets any document scroll offsets induced by iOS PWA input focus.
 */
export function useMobileViewport(enabled = true): MobileViewportState {
  const [state, setState] = useState<MobileViewportState>(() => {
    if (typeof window === 'undefined') {
      return {
        isMobile: false,
        keyboardOpen: false,
        isStandalone: false,
        viewportHeight: undefined,
        viewportOffsetTop: undefined,
      };
    }
    const isMobile = window.innerWidth < 640;
    const isStandalone = isRunningStandalone();
    const vv = window.visualViewport;
    return {
      isMobile,
      keyboardOpen: false,
      isStandalone,
      viewportHeight: isMobile && vv ? Math.round(vv.height) : undefined,
      viewportOffsetTop: isMobile && vv ? Math.round(vv.offsetTop) : undefined,
    };
  });

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    const isMobile = window.innerWidth < 640;
    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;

    // Lock background scrolling when modal is open on mobile / PWA
    if (isMobile) {
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
    }

    // In PWA, prevent iOS from scrolling the background window when inputs are focused
    const handleScrollLock = () => {
      if (isMobile && window.scrollY !== 0) {
        window.scrollTo(0, 0);
      }
    };
    window.addEventListener('scroll', handleScrollLock, { passive: true });

    const update = () => {
      const mobileActive = window.innerWidth < 640;
      const standalone = isRunningStandalone();
      if (!mobileActive) {
        setState({
          isMobile: false,
          keyboardOpen: false,
          isStandalone: standalone,
          viewportHeight: undefined,
          viewportOffsetTop: undefined,
        });
        return;
      }

      const vv = window.visualViewport;
      if (vv) {
        const kbOpen = window.innerHeight - vv.height > 50;
        setState({
          isMobile: true,
          keyboardOpen: kbOpen,
          isStandalone: standalone,
          viewportHeight: Math.round(vv.height),
          viewportOffsetTop: Math.round(vv.offsetTop),
        });
      } else {
        setState({
          isMobile: true,
          keyboardOpen: false,
          isStandalone: standalone,
          viewportHeight: undefined,
          viewportOffsetTop: undefined,
        });
      }
    };

    update();

    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', update);
      vv.addEventListener('scroll', update);
    }
    window.addEventListener('resize', update);

    return () => {
      if (isMobile) {
        document.body.style.overflow = prevBodyOverflow;
        document.documentElement.style.overflow = prevHtmlOverflow;
      }
      window.removeEventListener('scroll', handleScrollLock);
      if (vv) {
        vv.removeEventListener('resize', update);
        vv.removeEventListener('scroll', update);
      }
      window.removeEventListener('resize', update);
    };
  }, [enabled]);

  return state;
}

/**
 * Calculates modal outer wrapper and inner dialog style bounds for mobile & PWA keyboard handling.
 */
export function getMobileModalStyles(
  isMobile: boolean,
  viewportHeight: number | undefined,
  viewportOffsetTop: number | undefined
): {
  outerStyle?: React.CSSProperties;
  dialogStyle?: React.CSSProperties;
} {
  if (!isMobile || !viewportHeight) {
    return {};
  }
  return {
    outerStyle: {
      height: `${viewportHeight}px`,
      maxHeight: `${viewportHeight}px`,
      top: `${viewportOffsetTop || 0}px`,
      bottom: 'auto',
    },
    dialogStyle: {
      height: `${viewportHeight}px`,
      maxHeight: `${viewportHeight}px`,
    },
  };
}
