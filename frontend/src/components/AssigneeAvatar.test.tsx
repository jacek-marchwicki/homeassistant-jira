import { describe, it, expect } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AssigneeAvatar, getInitials } from './AssigneeAvatar.tsx';
import { JiraUser } from '../types/jira.ts';

// Configure React act environment for Happy-DOM
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('getInitials', () => {
  it('correctly extracts two initials from full names', () => {
    expect(getInitials('Jacek Marchwicki')).toBe('JM');
    expect(getInitials('Alex Lead')).toBe('AL');
    expect(getInitials('John Doe')).toBe('JD');
  });

  it('correctly handles single-word names', () => {
    expect(getInitials('Admin')).toBe('AD');
    expect(getInitials('X')).toBe('X');
  });

  it('handles multi-word names by taking first and last name initials', () => {
    expect(getInitials('John Middle Doe')).toBe('JD');
  });

  it('falls back to ? for empty or missing names', () => {
    expect(getInitials('')).toBe('?');
    expect(getInitials('   ')).toBe('?');
    expect(getInitials(undefined)).toBe('?');
  });
});

describe('AssigneeAvatar component', () => {
  it('renders unassigned indicator when assignee is missing', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(<AssigneeAvatar />);
    });

    expect(container.textContent).toBe('-');
    expect(container.firstElementChild?.getAttribute('title')).toBe('Unassigned');
    await act(async () => {
      root.unmount();
    });
  });

  it('renders user initials when assignee is provided without avatar URL', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const user: JiraUser = {
      accountId: 'usr-1',
      displayName: 'Jacek Marchwicki',
    };

    await act(async () => {
      root.render(<AssigneeAvatar assignee={user} />);
    });

    expect(container.textContent).toContain('JM');
    expect(container.firstElementChild?.getAttribute('title')).toBe('Jacek Marchwicki');
    await act(async () => {
      root.unmount();
    });
  });

  it('renders base initials and img overlay when avatar URL is provided', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const user: JiraUser = {
      accountId: 'usr-2',
      displayName: 'Alex Lead',
      avatarUrl: 'https://example.com/avatar.png',
    };

    await act(async () => {
      root.render(<AssigneeAvatar assignee={user} />);
    });

    // Base initials must always be present to prevent blank avatars
    expect(container.textContent).toContain('AL');
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('https://example.com/avatar.png');
    await act(async () => {
      root.unmount();
    });
  });
});
