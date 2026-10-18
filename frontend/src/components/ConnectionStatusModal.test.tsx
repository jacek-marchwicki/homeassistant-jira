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
});
