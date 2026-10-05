import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { usePwaInstall, type PwaInstallState } from './usePwaInstall.ts';
import type { BeforeInstallPromptEvent } from './pwa.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('usePwaInstall hook', () => {
  let latestState: PwaInstallState | null = null;
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  function TestComponent() {
    latestState = usePwaInstall();
    return (
      <div>
        <span data-testid="can-install">{String(latestState.canInstall)}</span>
        <span data-testid="is-installable">{String(latestState.isInstallable)}</span>
        <span data-testid="is-installed">{String(latestState.isInstalled)}</span>
        <span data-testid="is-standalone">{String(latestState.isStandalone)}</span>
        <span data-testid="show-help">{String(latestState.showHelpModal)}</span>
        <button data-testid="btn-install" onClick={() => latestState?.triggerInstall()}>
          Install
        </button>
      </div>
    );
  }

  beforeEach(() => {
    latestState = null;
    sessionStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it('initializes with default non-standalone, non-installed state', async () => {
    await act(async () => {
      root.render(<TestComponent />);
    });

    expect(latestState?.canInstall).toBe(true);
    expect(latestState?.isInstallable).toBe(false);
    expect(latestState?.isInstalled).toBe(false);
    expect(latestState?.showHelpModal).toBe(false);
  });

  it('captures beforeinstallprompt event and marks app installable', async () => {
    await act(async () => {
      root.render(<TestComponent />);
    });

    const mockPromptEvent = new Event('beforeinstallprompt') as BeforeInstallPromptEvent;
    Object.assign(mockPromptEvent, {
      platforms: ['android'],
      userChoice: Promise.resolve({ outcome: 'accepted', platform: 'android' }),
      prompt: vi.fn().mockResolvedValue(undefined),
    });

    await act(async () => {
      window.dispatchEvent(mockPromptEvent);
    });

    expect(latestState?.isInstallable).toBe(true);
    expect(latestState?.canInstall).toBe(true);
  });

  it('triggers prompt and marks installed when user accepts', async () => {
    await act(async () => {
      root.render(<TestComponent />);
    });

    const mockPrompt = vi.fn().mockResolvedValue(undefined);
    const mockPromptEvent = new Event('beforeinstallprompt') as BeforeInstallPromptEvent;
    Object.assign(mockPromptEvent, {
      platforms: ['android'],
      userChoice: Promise.resolve({ outcome: 'accepted', platform: 'android' }),
      prompt: mockPrompt,
    });

    await act(async () => {
      window.dispatchEvent(mockPromptEvent);
    });

    let outcome: string | undefined;
    await act(async () => {
      outcome = await latestState?.triggerInstall();
    });

    expect(mockPrompt).toHaveBeenCalled();
    expect(outcome).toBe('accepted');
    expect(latestState?.isInstalled).toBe(true);
    expect(latestState?.canInstall).toBe(false);
  });

  it('opens help modal when triggerInstall is called without native prompt', async () => {
    await act(async () => {
      root.render(<TestComponent />);
    });

    let outcome: string | undefined;
    await act(async () => {
      outcome = await latestState?.triggerInstall();
    });

    expect(outcome).toBe('manual');
    expect(latestState?.showHelpModal).toBe(true);

    await act(async () => {
      latestState?.closeHelpModal();
    });

    expect(latestState?.showHelpModal).toBe(false);
  });

  it('handles appinstalled event', async () => {
    await act(async () => {
      root.render(<TestComponent />);
    });

    await act(async () => {
      window.dispatchEvent(new Event('appinstalled'));
    });

    expect(latestState?.isInstalled).toBe(true);
    expect(latestState?.canInstall).toBe(false);
  });
});
