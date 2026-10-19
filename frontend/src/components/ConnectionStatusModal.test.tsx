import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ConnectionStatusModal } from './ConnectionStatusModal.tsx';
import { Header } from './Header.tsx';
import { useBoardStore } from '../store/boardStore.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ConnectionStatusModal', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    act(() => {
      useBoardStore.setState({
        wsConnected: true,
        syncStatus: 'synced',
        pendingSyncCount: 0,
        offlineOutbox: [],
        syncError: null,
        connectionDetails: {
          lastError: null,
          lastConnectedAt: null,
          lastDisconnectedAt: null,
          nextRetryAt: null,
          retryAttempt: 0,
        },
        boardName: 'Board',
        sprintName: 'Sprint',
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

  it('renders nothing when closed', async () => {
    await act(async () => {
      root.render(<ConnectionStatusModal isOpen={false} onClose={() => {}} />);
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('shows connected status and empty pending list', async () => {
    await act(async () => {
      root.render(<ConnectionStatusModal isOpen={true} onClose={() => {}} />);
    });
    const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain('Connected');
    expect(dialog.textContent).toContain('Nothing pending');
  });

  it('shows disconnect cause, retry time and pending changes', async () => {
    await act(async () => {
      useBoardStore.setState({
        wsConnected: false,
        syncStatus: 'offline',
        pendingSyncCount: 2,
        syncError: 'Network request failed',
        offlineOutbox: [
          {
            id: '1',
            action: 'transition_issue',
            issueKey: 'PROJ-1',
            payload: {},
            createdAt: Date.now(),
          },
          { id: '2', action: 'create_issue', payload: {}, createdAt: Date.now() },
        ],
        connectionDetails: {
          lastError: 'WebSocket connection failed',
          lastConnectedAt: null,
          lastDisconnectedAt: Date.now(),
          nextRetryAt: Date.now() + 3000,
          retryAttempt: 2,
        },
      });
      root.render(<ConnectionStatusModal isOpen={true} onClose={() => {}} />);
    });
    const text = (container.querySelector('[role="dialog"]') as HTMLElement).textContent!;
    expect(text).toContain('Reconnecting');
    expect(text).toContain('WebSocket connection failed');
    expect(text).toContain('Network request failed');
    expect(text).toContain('Retrying in');
    expect(text).toContain('PROJ-1');
    expect(text).toContain('Transition issue');
    expect(text).toContain('Create issue');
  });

  it('calls onClose from close button', async () => {
    const onClose = vi.fn();
    await act(async () => {
      root.render(<ConnectionStatusModal isOpen={true} onClose={onClose} />);
    });
    (container.querySelector('button[aria-label="Close"]') as HTMLButtonElement).click();
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose on Escape key', async () => {
    const onClose = vi.fn();
    await act(async () => {
      root.render(<ConnectionStatusModal isOpen={true} onClose={onClose} />);
    });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('opens from Header connection badge and sets store state', async () => {
    expect(useBoardStore.getState().isConnectionModalOpen).toBe(false);
    await act(async () => {
      root.render(<Header />);
    });
    const btn = container.querySelector(
      'button[data-testid="connection-status-button"]'
    ) as HTMLButtonElement;
    expect(btn).not.toBeNull();
    await act(async () => {
      btn.click();
    });
    expect(useBoardStore.getState().isConnectionModalOpen).toBe(true);
  });

  it('displays detailed changes for pending transactions of all action types', async () => {
    await act(async () => {
      useBoardStore.setState({
        offlineOutbox: [
          {
            id: 'tx-trans',
            action: 'transition_issue',
            issueKey: 'PROJ-10',
            payload: { target_status: 'In Progress', target_category: 'inprogress' },
            createdAt: Date.now(),
          },
          {
            id: 'tx-update',
            action: 'update_issue',
            issueKey: 'PROJ-11',
            payload: { summary: 'Fix login button', priority: 'high', status_name: 'Done' },
            createdAt: Date.now(),
          },
          {
            id: 'tx-create',
            action: 'create_issue',
            issueKey: 'PROJ-TEMP-1',
            payload: { summary: 'New offline story', issue_type: 'Story', priority: 'medium' },
            createdAt: Date.now(),
          },
          {
            id: 'tx-rank',
            action: 'rank_issue',
            issueKey: 'PROJ-12',
            payload: { rank_before_key: 'PROJ-15' },
            createdAt: Date.now(),
          },
        ],
      });
      root.render(<ConnectionStatusModal isOpen={true} onClose={() => {}} />);
    });

    const text = (container.querySelector('[role="dialog"]') as HTMLElement).textContent!;
    // Transition details
    expect(text).toContain('In Progress');
    // Update details
    expect(text).toContain('Fix login button');
    expect(text).toContain('high');
    expect(text).toContain('Done');
    // Create details
    expect(text).toContain('New offline story');
    expect(text).toContain('Story');
    // Rank details
    expect(text).toContain('PROJ-15');
  });

  it('allows user to remove a pending transaction via remove button', async () => {
    const removePendingTransaction = vi.fn();
    (useBoardStore.getState() as any).removePendingTransaction = removePendingTransaction;

    await act(async () => {
      useBoardStore.setState({
        offlineOutbox: [
          {
            id: 'tx-to-remove',
            action: 'update_issue',
            issueKey: 'PROJ-20',
            payload: { summary: 'Accidental edit' },
            createdAt: Date.now(),
          },
        ],
      });
      root.render(<ConnectionStatusModal isOpen={true} onClose={() => {}} />);
    });

    const removeBtn = container.querySelector(
      'button[aria-label="Remove transaction tx-to-remove"]'
    ) as HTMLButtonElement | null;
    expect(removeBtn).not.toBeNull();

    await act(async () => {
      removeBtn!.click();
    });

    expect(removePendingTransaction).toHaveBeenCalledWith('tx-to-remove');
  });

  it('provides an option to clear all local data and fetch fresh data from backend', async () => {
    const clearLocalDataAndRefetch = vi.fn().mockResolvedValue(undefined);
    (useBoardStore.getState() as any).clearLocalDataAndRefetch = clearLocalDataAndRefetch;

    await act(async () => {
      useBoardStore.setState({
        offlineOutbox: [
          {
            id: 'tx-1',
            action: 'update_issue',
            issueKey: 'PROJ-30',
            payload: { summary: 'Pending change' },
            createdAt: Date.now(),
          },
        ],
      });
      root.render(<ConnectionStatusModal isOpen={true} onClose={() => {}} />);
    });

    const clearBtn = container.querySelector(
      'button[data-testid="clear-local-data-button"]'
    ) as HTMLButtonElement | null;
    expect(clearBtn).not.toBeNull();

    await act(async () => {
      clearBtn!.click();
    });

    expect(clearLocalDataAndRefetch).toHaveBeenCalled();
  });
});
