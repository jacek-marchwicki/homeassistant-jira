import { useState, useEffect } from 'react';

export interface MobileViewportState {
  isMobile: boolean;
  keyboardOpen: boolean;
  viewportHeight: number | undefined;
  viewportOffsetTop: number | undefined;
}

/**
 * Hook to track mobile layout and visual viewport metrics (especially virtual keyboard appearance).
 *
 * On mobile devices, opening the software keyboard shrinks `window.visualViewport.height`.
 * This hook allows full-screen modals to constrain their height to the visible area
 * and position their bottom edge above the keyboard, enabling complete scrollability.
 */
export function useMobileViewport(enabled = true): MobileViewportState {
  const [state, setState] = useState<MobileViewportState>(() => {
    if (typeof window === 'undefined') {
      return {
        isMobile: false,
        keyboardOpen: false,
        viewportHeight: undefined,
        viewportOffsetTop: undefined,
      };
    }
    const isMobile = window.innerWidth < 640;
    const vv = window.visualViewport;
    return {
      isMobile,
      keyboardOpen: false,
      viewportHeight: isMobile && vv ? Math.round(vv.height) : undefined,
      viewportOffsetTop: isMobile && vv ? Math.round(vv.offsetTop) : undefined,
    };
  });

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    const update = () => {
      const isMobile = window.innerWidth < 640;
      if (!isMobile) {
        setState({
          isMobile: false,
          keyboardOpen: false,
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
          viewportHeight: Math.round(vv.height),
          viewportOffsetTop: Math.round(vv.offsetTop),
        });
      } else {
        setState({
          isMobile: true,
          keyboardOpen: false,
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
      if (vv) {
        vv.removeEventListener('resize', update);
        vv.removeEventListener('scroll', update);
      }
      window.removeEventListener('resize', update);
    };
  }, [enabled]);

  return state;
}
