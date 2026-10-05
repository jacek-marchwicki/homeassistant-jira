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
});
