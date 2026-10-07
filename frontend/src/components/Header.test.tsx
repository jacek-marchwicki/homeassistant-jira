import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Header } from './Header.tsx';
import { useBoardStore } from '../store/boardStore.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Header component', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    act(() => {
      useBoardStore.setState({
        boardName: 'Engineering Sprint Board',
        sprintName: 'Active Sprint 42',
        wsConnected: true,
        theme: 'dark',
        currentView: 'board',
        issues: [],
        columns: [],
      });
    });

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

  it('renders board title, sprint name, and live indicator', async () => {
    await act(async () => {
      root.render(<Header />);
    });

    expect(container.textContent).toContain('Engineering Sprint Board');
    expect(container.textContent).toContain('Active Sprint 42');
    expect(container.textContent).toContain('Live WebSocket');
  });

  it('renders Install button when canInstall is true and handles click', async () => {
    const handleInstall = vi.fn();

    await act(async () => {
      root.render(<Header canInstall={true} onInstall={handleInstall} />);
    });

    const installBtn = container.querySelector('button[aria-label="Install App"]') as HTMLButtonElement;
    expect(installBtn).not.toBeNull();
    expect(installBtn.textContent).toContain('Install');

    await act(async () => {
      installBtn.click();
    });

    expect(handleInstall).toHaveBeenCalledTimes(1);
  });

  it('does not render Install button when canInstall is false', async () => {
    await act(async () => {
      root.render(<Header canInstall={false} />);
    });

    const installBtn = container.querySelector('button[aria-label="Install App"]');
    expect(installBtn).toBeNull();
  });

  it('renders single-line header with flex-nowrap, z-30 stacking, and right-pinned Create button', async () => {
    await act(async () => {
      root.render(<Header />);
    });

    const header = container.querySelector('header');
    expect(header).not.toBeNull();
    expect(header?.className).toContain('flex-nowrap');
    expect(header?.className).not.toContain('flex-wrap');
    expect(header?.className).toContain('z-30');

    // Left navigation container is horizontally scrollable with no-scrollbar
    const navContainer = header?.firstElementChild as HTMLElement;
    expect(navContainer).not.toBeNull();
    expect(navContainer.className).toContain('overflow-x-auto');
    expect(navContainer.className).toContain('no-scrollbar');

    // Right action container pins Create button to top right corner
    const rightContainer = header?.lastElementChild as HTMLElement;
    expect(rightContainer).not.toBeNull();
    expect(rightContainer.className).toContain('shrink-0');
    expect(rightContainer.className).toContain('ml-auto');
    expect(rightContainer.querySelector('button[aria-label="Create Issue"]')).not.toBeNull();
  });

  it('hides board name and sprint name (Active issues) on mobile screens', async () => {
    await act(async () => {
      root.render(<Header />);
    });

    const titleContainer = container.querySelector('h1')?.parentElement;
    expect(titleContainer).not.toBeNull();
    expect(titleContainer?.className).toContain('hidden');
    expect(titleContainer?.className).toContain('sm:block');
  });

  it('renders all key mobile navigation controls (Board, Backlog, Create, WebSocket, Themes)', async () => {
    await act(async () => {
      root.render(<Header />);
    });

    expect(container.querySelector('button[aria-label="Kanban Board View"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Backlog View"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Create Issue"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Theme Selection"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Dark Mode"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Light Mode"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Kiosk Mode"]')).not.toBeNull();
  });

  it('opens mobile theme dropdown and switches theme when an option is clicked', async () => {
    await act(async () => {
      root.render(<Header />);
    });

    const themeDropdownTrigger = container.querySelector(
      'button[aria-label="Theme Selection"]'
    ) as HTMLButtonElement;
    expect(themeDropdownTrigger).not.toBeNull();
    expect(themeDropdownTrigger.getAttribute('aria-expanded')).toBe('false');

    await act(async () => {
      themeDropdownTrigger.click();
    });

    expect(themeDropdownTrigger.getAttribute('aria-expanded')).toBe('true');
    const menu = container.querySelector('div[role="listbox"][aria-label="Select Theme"]');
    expect(menu).not.toBeNull();

    // Click Light Mode option
    const options = menu?.querySelectorAll('button[role="option"]');
    const lightOption = Array.from(options || []).find((btn) =>
      btn.textContent?.includes('Light Mode')
    ) as HTMLButtonElement;
    expect(lightOption).toBeDefined();

    await act(async () => {
      lightOption.click();
    });

    expect(useBoardStore.getState().theme).toBe('light');
    expect(container.querySelector('div[role="listbox"][aria-label="Select Theme"]')).toBeNull();
  });

  it('renders offline badge with pending count when syncStatus is offline', async () => {
    act(() => {
      useBoardStore.setState({
        syncStatus: 'offline',
        pendingSyncCount: 3,
      });
    });

    await act(async () => {
      root.render(<Header />);
    });

    const offlineBadge = container.querySelector('[data-testid="offline-sync-badge"]');
    expect(offlineBadge).not.toBeNull();
    expect(offlineBadge?.textContent).toContain('Offline (3 pending)');
  });

  it('renders syncing badge when syncStatus is syncing', async () => {
    act(() => {
      useBoardStore.setState({
        syncStatus: 'syncing',
        pendingSyncCount: 0,
      });
    });

    await act(async () => {
      root.render(<Header />);
    });

    const syncingBadge = container.querySelector('[data-testid="syncing-badge"]');
    expect(syncingBadge).not.toBeNull();
    expect(syncingBadge?.textContent).toContain('Syncing');
  });
});

