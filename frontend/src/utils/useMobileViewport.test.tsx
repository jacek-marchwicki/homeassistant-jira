import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useMobileViewport, getMobileModalStyles, MobileViewportState } from './useMobileViewport.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useMobileViewport hook', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let latestResult: MobileViewportState | null = null;

  function TestComponent({ enabled = true }: { enabled?: boolean }) {
    latestResult = useMobileViewport(enabled);
    return (
      <div>
        <span data-testid="is-mobile">{String(latestResult.isMobile)}</span>
        <span data-testid="keyboard-open">{String(latestResult.keyboardOpen)}</span>
        <span data-testid="viewport-height">{String(latestResult.viewportHeight ?? 'none')}</span>
      </div>
    );
  }

  const originalInnerWidth = window.innerWidth;
  const originalInnerHeight = window.innerHeight;
  const originalVisualViewport = window.visualViewport;

  beforeEach(() => {
    vi.restoreAllMocks();
    latestResult = null;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    Object.defineProperty(window, 'innerWidth', { value: originalInnerWidth, writable: true });
    Object.defineProperty(window, 'innerHeight', { value: originalInnerHeight, writable: true });
    Object.defineProperty(window, 'visualViewport', { value: originalVisualViewport, writable: true });
  });

  it('detects desktop layout when width >= 640px', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true });
    Object.defineProperty(window, 'innerHeight', { value: 768, writable: true });

    await act(async () => {
      root.render(<TestComponent />);
    });

    expect(latestResult?.isMobile).toBe(false);
    expect(latestResult?.keyboardOpen).toBe(false);
    expect(latestResult?.viewportHeight).toBeUndefined();
  });

  it('detects mobile layout and tracks visualViewport height without keyboard', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 375, writable: true });
    Object.defineProperty(window, 'innerHeight', { value: 667, writable: true });

    const mockVisualViewport = {
      height: 667,
      width: 375,
      offsetTop: 0,
      pageTop: 0,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    Object.defineProperty(window, 'visualViewport', { value: mockVisualViewport, writable: true });

    await act(async () => {
      root.render(<TestComponent />);
    });

    expect(latestResult?.isMobile).toBe(true);
    expect(latestResult?.keyboardOpen).toBe(false);
    expect(latestResult?.viewportHeight).toBe(667);
    expect(latestResult?.viewportOffsetTop).toBe(0);
  });

  it('detects keyboard open when visualViewport shrinks significantly on mobile', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 375, writable: true });
    Object.defineProperty(window, 'innerHeight', { value: 667, writable: true });

    let resizeCallback: (() => void) | null = null;
    const mockVisualViewport = {
      height: 667,
      width: 375,
      offsetTop: 0,
      pageTop: 0,
      addEventListener: vi.fn((event: string, cb: () => void) => {
        if (event === 'resize') resizeCallback = cb;
      }),
      removeEventListener: vi.fn(),
    };
    Object.defineProperty(window, 'visualViewport', { value: mockVisualViewport, writable: true });

    await act(async () => {
      root.render(<TestComponent />);
    });

    expect(latestResult?.keyboardOpen).toBe(false);

    // Simulate keyboard opening (height shrinks from 667 to 370)
    mockVisualViewport.height = 370;
    await act(async () => {
      resizeCallback?.();
    });

    expect(latestResult?.keyboardOpen).toBe(true);
    expect(latestResult?.viewportHeight).toBe(370);
  });

  it('locks body overflow while enabled on mobile and restores on unmount', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 375, writable: true });
    document.body.style.overflow = 'visible';

    await act(async () => {
      root.render(<TestComponent enabled={true} />);
    });

    expect(document.body.style.overflow).toBe('hidden');

    await act(async () => {
      root.unmount();
    });

    expect(document.body.style.overflow).toBe('visible');
  });

  it('calculates getMobileModalStyles for bounded mobile modal positioning', () => {
    const desktopStyles = getMobileModalStyles(false, 350, 0);
    expect(desktopStyles.outerStyle).toBeUndefined();
    expect(desktopStyles.dialogStyle).toBeUndefined();

    const mobileStyles = getMobileModalStyles(true, 350, 20);
    expect(mobileStyles.outerStyle).toEqual({
      height: '350px',
      maxHeight: '350px',
      top: '20px',
      bottom: 'auto',
    });
    expect(mobileStyles.dialogStyle).toEqual({
      height: '350px',
      maxHeight: '350px',
    });
  });
});
