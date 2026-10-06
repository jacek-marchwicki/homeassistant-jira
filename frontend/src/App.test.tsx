import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { useBoardStore } from './store/boardStore.ts';
import { JiraIssue } from './types/jira.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const testIssue: JiraIssue = {
  id: '101',
  key: 'PROJ-101',
  summary: 'Setup CI/CD pipeline',
  priority: 'high',
  status: { id: 'col-todo', name: 'To Do', category: 'todo' },
  updated_at: '2026-10-05T00:00:00Z',
};

describe('App component loading indicator & board rendering', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.restoreAllMocks();
    act(() => {
      useBoardStore.setState({
        isLoading: true,
        boardName: '',
        sprintName: '',
        issues: [],
        errorMessage: null,
      });
    });
    global.fetch = vi.fn().mockImplementation(() => new Promise(() => {})); // pending promise
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

  it('renders loading progress indicator while board data is loading', async () => {
    // Return pending promise so it stays loading
    global.fetch = vi.fn().mockImplementation(() => new Promise(() => {}));

    act(() => {
      useBoardStore.setState({
        isLoading: true,
        boardName: '',
        sprintName: '',
        issues: [],
      });
    });

    await act(async () => {
      root.render(<App />);
    });

    // Verify progress indicator is rendered
    const loader = container.querySelector('[data-testid="loading-indicator"]');
    expect(loader).not.toBeNull();
    expect(container.textContent).toContain('Loading board data...');
    expect(container.textContent).toContain('Connecting to Jira and fetching active sprint issues...');

    // Verify hardcoded sample titles/data are NOT visible during loading
    expect(container.textContent).not.toContain('Engineering Sprint Board');
    expect(container.textContent).not.toContain('Active Sprint 42');
  });

  it('renders board header, filters, and columns once loading completes', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        board_name: 'Engineering Sprint Board',
        sprint_name: 'Active Sprint 42',
        columns: [],
        issues: [testIssue],
      }),
    });

    await act(async () => {
      root.render(<App />);
    });

    expect(container.querySelector('[data-testid="loading-indicator"]')).toBeNull();
    expect(container.textContent).toContain('Engineering Sprint Board');
    expect(container.textContent).toContain('Active Sprint 42');
    expect(container.textContent).toContain('Setup CI/CD pipeline');
  });

  it('renders error state with retry button when initial board loading fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ detail: 'Unable to connect to Jira backend server.' }),
    });

    await act(async () => {
      root.render(<App />);
    });

    expect(container.textContent).toContain('Failed to load board');
    expect(container.textContent).toContain('Unable to connect to Jira backend server.');
    const retryBtn = container.querySelector('button');
    expect(retryBtn).not.toBeNull();
    expect(retryBtn?.textContent).toContain('Retry');
  });

  it('renders board immediately without loading screen when issues are already cached', async () => {
    // Pending fetch to simulate background revalidation
    global.fetch = vi.fn().mockImplementation(() => new Promise(() => {}));

    act(() => {
      useBoardStore.setState({
        isLoading: false,
        isSyncing: true,
        boardName: 'Engineering Sprint Board',
        sprintName: 'Active Sprint 42',
        issues: [testIssue],
      });
    });

    await act(async () => {
      root.render(<App />);
    });

    // Verify loading indicator is NOT shown
    expect(container.querySelector('[data-testid="loading-indicator"]')).toBeNull();
    // Verify board is immediately rendered
    expect(container.textContent).toContain('Engineering Sprint Board');
    expect(container.textContent).toContain('Setup CI/CD pipeline');
  });
});
