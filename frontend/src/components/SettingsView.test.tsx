import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsView } from './SettingsView.tsx';
import { useBoardStore } from '../store/boardStore.ts';
import { JiraIssue } from '../types/jira.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const issues: JiraIssue[] = [
  {
    id: '2',
    key: 'PROJ-2',
    summary: 'Task 2',
    priority: 'medium',
    status: { id: 'col-todo', name: 'To Do', category: 'todo' },
    assignee: { displayName: 'Sarah Connor' },
  },
];

describe('SettingsView', () => {
  beforeEach(() => {
    act(() => {
      useBoardStore.setState({
        issues,
        accountTypes: {},
        currentUser: 'Jacek Marchwicki',
        errorMessage: null,
        isSettingsOpen: true,
      });
    });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  });

  it('closes via the back button', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<SettingsView />);
    });
    await act(async () => {
      (container.querySelector('[aria-label="Back to board"]') as HTMLElement).click();
    });
    expect(useBoardStore.getState().isSettingsOpen).toBe(false);
    act(() => root.unmount());
  });

  it('rolls back and shows an error when the backend rejects the change', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<SettingsView />);
    });
    await act(async () => {
      (container.querySelector('[aria-label="Sarah Connor Child"]') as HTMLElement).click();
    });
    expect(useBoardStore.getState().accountTypes['sarah connor']).toBeUndefined();
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
    act(() => root.unmount());
  });

  it('lists accounts as Parent by default and switches one to Child', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<SettingsView />);
    });
    const parentBtn = container.querySelector('[aria-label="Sarah Connor Parent"]') as HTMLElement;
    const childBtn = container.querySelector('[aria-label="Sarah Connor Child"]') as HTMLElement;
    expect(parentBtn.getAttribute('aria-checked')).toBe('true');
    expect(childBtn.getAttribute('aria-checked')).toBe('false');
    await act(async () => {
      childBtn.click();
    });
    expect(useBoardStore.getState().accountTypes['sarah connor']).toBe('child');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/account-types'),
      expect.objectContaining({ method: 'PUT' })
    );
    expect(childBtn.getAttribute('aria-checked')).toBe('true');
    await act(async () => {
      parentBtn.click();
    });
    expect(useBoardStore.getState().accountTypes['sarah connor']).toBeUndefined();
    act(() => root.unmount());
  });

  it('displays the installed app version in the About section', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/health')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ status: 'ok', app: 'homeassistant-jira', version: '0.8.0' }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<SettingsView />);
    });

    const aboutHeading = container.querySelector('#settings-about-heading');
    expect(aboutHeading).toBeTruthy();
    expect(aboutHeading?.textContent).toBe('About');

    const versionBadge = container.querySelector('[data-testid="app-version"]');
    expect(versionBadge).toBeTruthy();
    expect(versionBadge?.textContent).toContain('0.8.0');

    act(() => root.unmount());
  });

  it('displays the installed app version even when offline (health check rejects)', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch (offline)'));

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<SettingsView />);
    });

    const versionBadge = container.querySelector('[data-testid="app-version"]');
    expect(versionBadge).toBeTruthy();
    expect(versionBadge?.textContent).toContain('0.8.0');

    // No error message displayed in alert
    expect(container.querySelector('[role="alert"]')).toBeNull();

    act(() => root.unmount());
  });

  it('displays backend version when different from client version', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/health')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ status: 'ok', app: 'homeassistant-jira', version: '0.9.0' }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<SettingsView />);
    });

    // Wait for microtask / state update
    await act(async () => {
      await Promise.resolve();
    });

    const backendBadge = container.querySelector('[data-testid="backend-version"]');
    expect(backendBadge).toBeTruthy();
    expect(backendBadge?.textContent).toContain('0.9.0');

    act(() => root.unmount());
  });
});
