import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { LoginView } from './LoginView.tsx';
import { useBoardStore } from '../store/boardStore.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('LoginView', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      useBoardStore.setState({
        authStatus: {
          authMode: 'gcp_oauth',
          googleClientId: 'mock-client-id.apps.googleusercontent.com',
          authenticated: false,
          user: null,
        },
        isAuthRequired: true,
      });
    });
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('renders sign-in prompt and Google sign-in button', async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(<LoginView />);
    });

    expect(container.textContent).toContain('Jira Dashboard');
    expect(container.textContent).toContain('Sign in with Google');

    const button = container.querySelector('button[aria-label="Sign in with Google"]') as HTMLButtonElement;
    expect(button).not.toBeNull();
    act(() => root.unmount());
  });

  it('displays error alert when auth_error query parameter is present', async () => {
    delete (window as any).location;
    window.location = new URL('https://example.com/?auth_error=Access+denied+for+email') as any;

    const root = createRoot(container);
    await act(async () => {
      root.render(<LoginView />);
    });

    expect(container.textContent).toContain('Access denied for email');
    act(() => root.unmount());
  });

  it('initiates OAuth redirect when sign-in button is clicked', async () => {
    delete (window as any).location;
    window.location = { href: '', search: '', pathname: '/' } as any;

    const root = createRoot(container);
    await act(async () => {
      root.render(<LoginView />);
    });

    const button = container.querySelector('button[aria-label="Sign in with Google"]') as HTMLButtonElement;
    await act(async () => {
      button.click();
    });

    expect(window.location.href).toContain('/api/auth/google/login');
    act(() => root.unmount());
  });
});
