import { describe, it, expect, afterEach } from 'vitest';
import { getBasePath, getApiUrl, getWsUrl } from './paths';

describe('Path and URL Utilities for Home Assistant Ingress and Standalone', () => {
  const originalLocation = window.location;

  function setMockLocation(pathname: string, host: string, protocol: string) {
    Object.defineProperty(window, 'location', {
      value: {
        pathname,
        host,
        protocol,
      },
      writable: true,
      configurable: true,
    });
  }

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
  });

  describe('getBasePath', () => {
    it('returns empty string when running at standard root /', () => {
      setMockLocation('/', 'localhost:3000', 'http:');
      expect(getBasePath()).toBe('');
    });

    it('returns empty string when running on standard standalone subpath without ingress prefix', () => {
      setMockLocation('/board/active', 'localhost:8000', 'http:');
      expect(getBasePath()).toBe('');
    });

    it('extracts Ingress prefix when running under Home Assistant Ingress dynamic proxy', () => {
      setMockLocation('/api/hassio_ingress/token-abc-123/', 'homeassistant.local:8123', 'http:');
      expect(getBasePath()).toBe('/api/hassio_ingress/token-abc-123');
    });

    it('extracts Ingress prefix when nested paths are appended', () => {
      setMockLocation(
        '/api/hassio_ingress/token-abc-123/issues/PROJ-101',
        'homeassistant.local:8123',
        'https:'
      );
      expect(getBasePath()).toBe('/api/hassio_ingress/token-abc-123');
    });
  });

  describe('getApiUrl', () => {
    it('returns cleanly formatted endpoint path in standalone mode', () => {
      setMockLocation('/', 'localhost:8000', 'http:');
      expect(getApiUrl('/api/board')).toBe('/api/board');
      expect(getApiUrl('api/board')).toBe('/api/board');
    });

    it('prefixes endpoint with Ingress path in Home Assistant mode', () => {
      setMockLocation(
        '/api/hassio_ingress/ingress-token-99/',
        'homeassistant.local:8123',
        'https:'
      );
      expect(getApiUrl('/api/board')).toBe('/api/hassio_ingress/ingress-token-99/api/board');
      expect(getApiUrl('api/issues/PROJ-101')).toBe(
        '/api/hassio_ingress/ingress-token-99/api/issues/PROJ-101'
      );
    });
  });

  describe('getWsUrl', () => {
    it('constructs ws:// URL for HTTP host in standalone mode', () => {
      setMockLocation('/', '192.168.1.100:8000', 'http:');
      expect(getWsUrl()).toBe('ws://192.168.1.100:8000/ws');
    });

    it('constructs wss:// URL for HTTPS host in standalone mode', () => {
      setMockLocation('/', 'jira.example.com', 'https:');
      expect(getWsUrl()).toBe('wss://jira.example.com/ws');
    });

    it('constructs Ingress-prefixed wss:// URL inside Home Assistant with HTTPS', () => {
      setMockLocation(
        '/api/hassio_ingress/secure-token-55/',
        'nabucasa.ui.nabu.casa',
        'https:'
      );
      expect(getWsUrl()).toBe('wss://nabucasa.ui.nabu.casa/api/hassio_ingress/secure-token-55/ws');
    });

    it('constructs Ingress-prefixed ws:// URL inside Home Assistant with local HTTP', () => {
      setMockLocation(
        '/api/hassio_ingress/local-token-77/',
        'homeassistant.local:8123',
        'http:'
      );
      expect(getWsUrl()).toBe('ws://homeassistant.local:8123/api/hassio_ingress/local-token-77/ws');
    });
  });
});
