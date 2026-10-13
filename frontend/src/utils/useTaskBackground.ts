import { useState, useEffect } from 'react';
import type React from 'react';
import { getApiUrl } from './paths.ts';

// In-memory cache across component lifecycles to prevent repeated network probes
const backgroundAvailabilityCache = new Map<string, boolean>();

export interface TaskBackgroundResult {
  backgroundUrl: string | null;
  hasBackground: boolean;
}

/**
 * React hook that probes and resolves background illustration URLs for tasks.
 * If the image endpoint returns 204 No Content, 404, or network error,
 * hasBackground is false and backgroundUrl is null, guaranteeing graceful degradation.
 */
export function useTaskBackground(issueKey?: string): TaskBackgroundResult {
  const [hasBackground, setHasBackground] = useState<boolean>(() => {
    if (!issueKey) return false;
    return backgroundAvailabilityCache.get(issueKey) ?? false;
  });

  const url = issueKey ? getApiUrl(`/api/issues/${issueKey}/background`) : null;

  useEffect(() => {
    if (!issueKey || !url) {
      setHasBackground(false);
      return;
    }

    if (backgroundAvailabilityCache.has(issueKey)) {
      setHasBackground(backgroundAvailabilityCache.get(issueKey)!);
      return;
    }

    let active = true;
    const img = new Image();
    img.onload = () => {
      backgroundAvailabilityCache.set(issueKey, true);
      if (active) setHasBackground(true);
    };
    img.onerror = () => {
      backgroundAvailabilityCache.set(issueKey, false);
      if (active) setHasBackground(false);
    };
    img.src = url;

    return () => {
      active = false;
    };
  }, [issueKey, url]);

  return {
    backgroundUrl: hasBackground ? url : null,
    hasBackground,
  };
}

/**
 * Returns CSS properties for rendering card background illustrations
 * with high-contrast semi-transparent gradient overlays for WCAG AAA text readability.
 */
export function getCardBackgroundStyle(backgroundUrl: string | null): React.CSSProperties {
  if (!backgroundUrl) return {};
  const isLight =
    typeof document !== 'undefined' &&
    document.documentElement.getAttribute('data-theme') === 'light';
  const overlayTop = isLight ? 'rgba(255, 255, 255, 0.32)' : 'rgba(17, 24, 39, 0.32)';
  const overlayBottom = isLight ? 'rgba(255, 255, 255, 0.8)' : 'rgba(17, 24, 39, 0.8)';

  return {
    backgroundImage: `linear-gradient(to bottom, ${overlayTop}, ${overlayBottom}), url(${backgroundUrl})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
  };
}

/**
 * Clears the in-memory background availability cache (useful for testing).
 */
export function clearBackgroundCache(): void {
  backgroundAvailabilityCache.clear();
}
