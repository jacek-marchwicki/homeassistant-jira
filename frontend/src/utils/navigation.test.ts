import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseRoute,
  buildPath,
  stripBasePath,
  pushRoute,
  replaceRoute,
  closeOverlayRoute,
  getCurrentRoute,
} from './navigation';

describe('navigation routes', () => {
  it('parses view, task, create and root routes', () => {
    expect(parseRoute('/')).toEqual({ kind: 'root' });
    expect(parseRoute('/board')).toEqual({ kind: 'view', view: 'board' });
    expect(parseRoute('/backlog/')).toEqual({ kind: 'view', view: 'backlog' });
    expect(parseRoute('/people')).toEqual({ kind: 'view', view: 'people' });
    expect(parseRoute('/task/HOME-123')).toEqual({ kind: 'task', key: 'HOME-123' });
    expect(parseRoute('/create')).toEqual({ kind: 'create' });
    expect(parseRoute('/nonsense')).toEqual({ kind: 'root' });
    expect(parseRoute('/task')).toEqual({ kind: 'root' });
    expect(parseRoute('/task/%E0%A4%A')).toEqual({ kind: 'root' });
  });

  it('builds paths that round-trip', () => {
    expect(buildPath({ kind: 'task', key: 'HOME-123' })).toBe('/task/HOME-123');
    expect(buildPath({ kind: 'view', view: 'people' })).toBe('/people');
    expect(buildPath({ kind: 'create' })).toBe('/create');
    expect(buildPath({ kind: 'root' })).toBe('/');
    expect(parseRoute(buildPath({ kind: 'task', key: 'A B-1' }))).toEqual({
      kind: 'task',
      key: 'A B-1',
    });
  });

  it('strips Ingress base path', () => {
    const base = '/api/hassio_ingress/tok';
    expect(stripBasePath(`${base}/task/HOME-1`, base)).toBe('/task/HOME-1');
    expect(stripBasePath(base, base)).toBe('/');
    expect(stripBasePath('/task/HOME-1', '')).toBe('/task/HOME-1');
  });
});

describe('navigation history', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/board');
  });

  it('pushes entries and reads the current route', () => {
    pushRoute({ kind: 'task', key: 'HOME-9' });
    expect(window.location.pathname).toBe('/task/HOME-9');
    expect(getCurrentRoute()).toEqual({ kind: 'task', key: 'HOME-9' });
  });

  it('does not push duplicate entries', () => {
    const before = window.history.length;
    pushRoute({ kind: 'view', view: 'board' });
    expect(window.history.length).toBe(before);
  });

  it('replaces the URL on deep-linked overlay close', () => {
    window.history.replaceState(null, '', '/task/HOME-1');
    closeOverlayRoute({ kind: 'view', view: 'board' });
    expect(window.location.pathname).toBe('/board');
  });

  it('replaceRoute swaps the current URL', () => {
    replaceRoute({ kind: 'view', view: 'backlog' });
    expect(window.location.pathname).toBe('/backlog');
  });

  it('parses and builds the settings route', () => {
    expect(parseRoute('/settings')).toEqual({ kind: 'settings' });
    expect(parseRoute('/settings/extra')).toEqual({ kind: 'root' });
    expect(buildPath({ kind: 'settings' })).toBe('/settings');
  });
});
