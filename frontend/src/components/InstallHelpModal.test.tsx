import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { InstallHelpModal } from './InstallHelpModal.tsx';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('InstallHelpModal component', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
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

  it('renders nothing when isOpen is false', async () => {
    await act(async () => {
      root.render(
        <InstallHelpModal
          isOpen={false}
          onClose={vi.fn()}
          isAndroid={false}
          isIOS={false}
        />
      );
    });

    expect(container.innerHTML).toBe('');
  });

  it('renders Android installation instructions when isAndroid is true', async () => {
    await act(async () => {
      root.render(
        <InstallHelpModal
          isOpen={true}
          onClose={vi.fn()}
          isAndroid={true}
          isIOS={false}
        />
      );
    });

    expect(container.textContent).toContain('Install Jira Dashboard');
    expect(container.textContent).toContain('Android (Chrome / Samsung Internet)');
    expect(container.textContent).toContain('three vertical dots');
    expect(container.textContent).toContain('Install app');
  });

  it('renders iOS installation instructions when isIOS is true', async () => {
    await act(async () => {
      root.render(
        <InstallHelpModal
          isOpen={true}
          onClose={vi.fn()}
          isAndroid={false}
          isIOS={true}
        />
      );
    });

    expect(container.textContent).toContain('Apple iOS (Safari)');
    expect(container.textContent).toContain('Share');
    expect(container.textContent).toContain('Add to Home Screen');
  });

  it('renders Desktop instructions when neither Android nor iOS', async () => {
    await act(async () => {
      root.render(
        <InstallHelpModal
          isOpen={true}
          onClose={vi.fn()}
          isAndroid={false}
          isIOS={false}
        />
      );
    });

    expect(container.textContent).toContain('Desktop Browser');
    expect(container.textContent).toContain('Install icon in the browser address bar');
  });

  it('calls onClose when close button is clicked', async () => {
    const handleClose = vi.fn();
    await act(async () => {
      root.render(
        <InstallHelpModal
          isOpen={true}
          onClose={handleClose}
          isAndroid={true}
          isIOS={false}
        />
      );
    });

    const closeBtn = container.querySelector('button[aria-label="Close"]') as HTMLButtonElement;
    expect(closeBtn).toBeDefined();

    await act(async () => {
      closeBtn.click();
    });

    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
