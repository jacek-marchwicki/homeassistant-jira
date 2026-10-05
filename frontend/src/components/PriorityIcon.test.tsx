import { describe, it, expect } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { PriorityIcon } from './PriorityIcon.tsx';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('PriorityIcon component', () => {
  it('renders appropriate icons for all Jira priorities', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    const priorities = ['highest', 'high', 'medium', 'low', 'lowest'] as const;

    for (const priority of priorities) {
      await act(async () => {
        root.render(<PriorityIcon priority={priority} />);
      });
      const svg = container.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(container.querySelector('[title]')?.getAttribute('title')).toContain(
        priority.charAt(0).toUpperCase() + priority.slice(1)
      );
    }

    await act(async () => {
      root.unmount();
    });
  });
});
