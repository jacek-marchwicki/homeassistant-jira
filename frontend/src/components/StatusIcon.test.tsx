import { describe, it, expect } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { StatusIcon } from './StatusIcon.tsx';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('StatusIcon component', () => {
  it('renders appropriate icons for status categories', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    const categories = ['todo', 'inprogress', 'in_review', 'done', 'blocked'] as const;

    for (const cat of categories) {
      await act(async () => {
        root.render(<StatusIcon category={cat} />);
      });
      const svg = container.querySelector('svg');
      expect(svg).not.toBeNull();
    }

    // Status name matching
    await act(async () => {
      root.render(<StatusIcon statusName="Backlog" />);
    });
    expect(container.querySelector('[title]')?.getAttribute('title')).toContain('Backlog');

    await act(async () => {
      root.render(<StatusIcon statusName="Done" />);
    });
    expect(container.querySelector('[title]')?.getAttribute('title')).toContain('Done');

    await act(async () => {
      root.unmount();
    });
  });
});
