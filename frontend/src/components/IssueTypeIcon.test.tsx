import { describe, it, expect } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { IssueTypeIcon } from './IssueTypeIcon.tsx';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('IssueTypeIcon component', () => {
  it('renders story icon with emerald styling', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(<IssueTypeIcon type="story" />);
    });

    const elem = container.querySelector('[aria-label="Story"]');
    expect(elem).not.toBeNull();
    expect(elem?.className).toContain('text-emerald-500');

    await act(async () => {
      root.unmount();
    });
  });

  it('renders bug icon with red styling', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(<IssueTypeIcon type="bug" />);
    });

    const elem = container.querySelector('[aria-label="Bug"]');
    expect(elem).not.toBeNull();
    expect(elem?.className).toContain('text-red-500');

    await act(async () => {
      root.unmount();
    });
  });

  it('renders task icon by default', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(<IssueTypeIcon type="task" />);
    });

    const elem = container.querySelector('[aria-label="Task"]');
    expect(elem).not.toBeNull();
    expect(elem?.className).toContain('text-blue-500');

    await act(async () => {
      root.unmount();
    });
  });
});
