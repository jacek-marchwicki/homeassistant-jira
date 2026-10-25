import { describe, it, expect } from 'vitest';
import { APP_VERSION } from './version.ts';

describe('APP_VERSION', () => {
  it('defines a valid semver version string matching package.json', () => {
    expect(APP_VERSION).toBeDefined();
    expect(typeof APP_VERSION).toBe('string');
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
    expect(APP_VERSION).toBe('0.7.0');
  });
});
