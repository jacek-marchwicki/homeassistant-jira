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
        currentView: 'people',
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
    expect(rightContainer.querySelector('a[aria-label="Create Issue"]')).not.toBeNull();
  });

  it('applies safe-area top inset padding to ensure buttons are displayed below the status bar', async () => {
    await act(async () => {
      root.render(<Header />);
    });

    const header = container.querySelector('header');
    expect(header).not.toBeNull();
    expect(header?.className).toContain('pt-[calc(0.5rem+env(safe-area-inset-top,0px))]');
    expect(header?.className).toContain('sticky');
    expect(header?.className).toContain('top-0');
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

  it('renders all key mobile navigation controls (People, Backlog, Create, WebSocket, Themes)', async () => {
    await act(async () => {
      root.render(<Header />);
    });

    expect(container.querySelector('button[aria-label="Kanban Board View"]')).toBeNull();
    expect(container.querySelector('a[aria-label="People View"]')).not.toBeNull();
    expect(container.querySelector('a[aria-label="Backlog View"]')).not.toBeNull();
    expect(container.querySelector('a[aria-label="Create Issue"]')).not.toBeNull();
    expect(container.querySelector('a[aria-label="Settings"]')).not.toBeNull();
    expect(container.querySelector('a[data-testid="connection-status-button"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Theme Selection"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Dark Mode"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Light Mode"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Kiosk Mode"]')).not.toBeNull();
  });

  it('switches currentView between "people" and "backlog" when view links are clicked', async () => {
    await act(async () => {
      root.render(<Header />);
    });

    const backlogLink = container.querySelector(
      'a[aria-label="Backlog View"]'
    ) as HTMLAnchorElement;
    expect(backlogLink).not.toBeNull();
    expect(backlogLink.getAttribute('href')).toBe('/backlog');

    await act(async () => {
      backlogLink.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(useBoardStore.getState().currentView).toBe('backlog');

    const peopleLink = container.querySelector(
      'a[aria-label="People View"]'
    ) as HTMLAnchorElement;
    expect(peopleLink).not.toBeNull();
    expect(peopleLink.getAttribute('href')).toBe('/people');

    await act(async () => {
      peopleLink.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(useBoardStore.getState().currentView).toBe('people');
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

  it('hides offline badge and displays Live WebSocket after reconnection and queue flush', async () => {
    act(() => {
      useBoardStore.setState({
        wsConnected: false,
        syncStatus: 'offline',
        pendingSyncCount: 1,
        offlineOutbox: [
          {
            id: 'item-1',
            action: 'update_issue',
            issueKey: 'PROJ-101',
            payload: { summary: 'New summary' },
            createdAt: Date.now(),
          },
        ],
      });
    });

    await act(async () => {
      root.render(<Header />);
    });

    // Offline and Reconnecting badges visible
    expect(container.querySelector('[data-testid="offline-sync-badge"]')?.textContent).toContain('Offline (1 pending)');
    expect(container.textContent).toContain('Reconnecting');

    // Simulate backend response on reconnection
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: '101',
        key: 'PROJ-101',
        summary: 'New summary',
        status: { id: 'col-todo', name: 'To Do', category: 'todo' },
      }),
    } as Response);

    // Reconnection occurs
    await act(async () => {
      useBoardStore.getState().setWsConnected(true);
    });

    // Offline badge is cleared, Live WebSocket is active
    expect(container.querySelector('[data-testid="offline-sync-badge"]')).toBeNull();
    expect(container.textContent).toContain('Live WebSocket');
    expect(useBoardStore.getState().pendingSyncCount).toBe(0);
    expect(useBoardStore.getState().syncStatus).toBe('synced');
  });
});


describe('Header settings icon', () => {
  it('renders an icon-only Settings button that opens the settings page', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<Header />);
    });
    const link = container.querySelector('a[aria-label="Settings"]') as HTMLAnchorElement;
    expect(link).toBeTruthy();
    expect(link.getAttribute('href')).toBe('/settings');
    expect(link.textContent?.trim()).toBe('');
    await act(async () => {
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(useBoardStore.getState().isSettingsOpen).toBe(true);
    act(() => {
      useBoardStore.getState().closeSettings();
      root.unmount();
    });
  });
});
