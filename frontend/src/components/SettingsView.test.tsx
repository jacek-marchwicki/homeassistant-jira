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
});
