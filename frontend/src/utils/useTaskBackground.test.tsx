import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import {
  useTaskBackground,
  clearBackgroundCache,
  getCardBackgroundStyle,
} from './useTaskBackground.ts';
import { useBoardStore } from '../store/boardStore.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useTaskBackground hook', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let latestResult: { backgroundUrl: string | null; hasBackground: boolean } | null = null;
  let originalImage: typeof Image;

  function TestComponent({ issueKey }: { issueKey?: string }) {
    latestResult = useTaskBackground(issueKey);
    return (
      <div>
        <span data-testid="has-bg">{String(latestResult.hasBackground)}</span>
        <span data-testid="bg-url">{latestResult.backgroundUrl ?? 'none'}</span>
      </div>
    );
  }

  beforeEach(() => {
    clearBackgroundCache();
    latestResult = null;
    originalImage = globalThis.Image;
    useBoardStore.setState({ hideImages: false });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    globalThis.Image = originalImage;
    vi.restoreAllMocks();
  });

  it('returns null and hasBackground false when issueKey is undefined', async () => {
    await act(async () => {
      root.render(<TestComponent />);
    });

    expect(latestResult?.hasBackground).toBe(false);
    expect(latestResult?.backgroundUrl).toBeNull();
  });

  it('sets hasBackground to true when image loads successfully', async () => {
    let triggerOnload: (() => void) | null = null;

    globalThis.Image = class {
      set onload(cb: () => void) {
        triggerOnload = cb;
      }
      set onerror(_cb: () => void) {}
      set src(_val: string) {}
    } as unknown as typeof Image;

    await act(async () => {
      root.render(<TestComponent issueKey="PROJ-101" />);
    });

    expect(latestResult?.hasBackground).toBe(false);

    await act(async () => {
      triggerOnload?.();
    });

    expect(latestResult?.hasBackground).toBe(true);
    expect(latestResult?.backgroundUrl).toContain('/api/issues/PROJ-101/background');
  });

  it('keeps hasBackground false when image fails to load (e.g. 204 No Content)', async () => {
    let triggerOnerror: (() => void) | null = null;

    globalThis.Image = class {
      set onload(_cb: () => void) {}
      set onerror(cb: () => void) {
        triggerOnerror = cb;
      }
      set src(_val: string) {}
    } as unknown as typeof Image;

    await act(async () => {
      root.render(<TestComponent issueKey="PROJ-102" />);
    });

    await act(async () => {
      triggerOnerror?.();
    });

    expect(latestResult?.hasBackground).toBe(false);
    expect(latestResult?.backgroundUrl).toBeNull();
  });

  it('suppresses background image and returns null when hideImages is true', async () => {
    let imageInstantiated = false;
    globalThis.Image = class {
      constructor() {
        imageInstantiated = true;
      }
      set onload(_cb: () => void) {}
      set onerror(_cb: () => void) {}
      set src(_val: string) {}
    } as unknown as typeof Image;

    useBoardStore.setState({ hideImages: true });

    await act(async () => {
      root.render(<TestComponent issueKey="PROJ-101" />);
    });

    expect(latestResult?.hasBackground).toBe(false);
    expect(latestResult?.backgroundUrl).toBeNull();
    expect(imageInstantiated).toBe(false);
  });

  it('computes correct card background styles with overlay gradient', () => {
    const styleWithBg = getCardBackgroundStyle('/api/issues/PROJ-101/background');
    expect(styleWithBg.backgroundImage).toContain('/api/issues/PROJ-101/background');
    expect(styleWithBg.backgroundImage).toContain('linear-gradient');
    expect(styleWithBg.backgroundImage).toContain('rgba(17, 24, 39, 0.32)');
    expect(styleWithBg.backgroundImage).toContain('rgba(17, 24, 39, 0.8)');
    expect(styleWithBg.backgroundSize).toBe('cover');
    expect(styleWithBg.backgroundPosition).toBe('center');

    // Test light theme overlay
    document.documentElement.setAttribute('data-theme', 'light');
    const lightStyle = getCardBackgroundStyle('/api/issues/PROJ-101/background');
    expect(lightStyle.backgroundImage).toContain('rgba(255, 255, 255, 0.32)');
    expect(lightStyle.backgroundImage).toContain('rgba(255, 255, 255, 0.8)');
    document.documentElement.removeAttribute('data-theme');

    const styleWithoutBg = getCardBackgroundStyle(null);
    expect(styleWithoutBg).toEqual({});
  });
});
