import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MobileInstallBanner } from './MobileInstallBanner.tsx';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('MobileInstallBanner component', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('renders banner when canInstall is true and not dismissed', async () => {
    await act(async () => {
      root.render(<MobileInstallBanner canInstall={true} onInstall={vi.fn()} />);
    });

    expect(container.textContent).toContain('Install Jira Dashboard');
    expect(container.textContent).toContain('Add to home screen');
    expect(container.querySelector('button[aria-label="Install App"]')).not.toBeNull();
  });

  it('does not render when canInstall is false', async () => {
    await act(async () => {
      root.render(<MobileInstallBanner canInstall={false} onInstall={vi.fn()} />);
    });

    expect(container.innerHTML).toBe('');
  });

  it('triggers onInstall callback when Install button is clicked', async () => {
    const handleInstall = vi.fn();
    await act(async () => {
      root.render(<MobileInstallBanner canInstall={true} onInstall={handleInstall} />);
    });

    const installBtn = container.querySelector('button[aria-label="Install App"]') as HTMLButtonElement;
    expect(installBtn).not.toBeNull();

    await act(async () => {
      installBtn.click();
    });

    expect(handleInstall).toHaveBeenCalledTimes(1);
  });

  it('dismisses banner and sets localStorage when dismiss button is clicked', async () => {
    await act(async () => {
      root.render(<MobileInstallBanner canInstall={true} onInstall={vi.fn()} />);
    });

    const dismissBtn = container.querySelector('button[aria-label="Dismiss install banner"]') as HTMLButtonElement;
    expect(dismissBtn).not.toBeNull();

    await act(async () => {
      dismissBtn.click();
    });

    expect(container.innerHTML).toBe('');
    expect(localStorage.getItem('jira_pwa_banner_dismissed')).toBe('1');
  });

  it('remains hidden on mount if previously dismissed in localStorage', async () => {
    localStorage.setItem('jira_pwa_banner_dismissed', '1');

    await act(async () => {
      root.render(<MobileInstallBanner canInstall={true} onInstall={vi.fn()} />);
    });

    expect(container.innerHTML).toBe('');
  });
});
