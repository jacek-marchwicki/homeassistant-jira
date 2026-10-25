import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getViewTransitionName, runWithViewTransition } from './viewTransition.ts';

describe('viewTransition utility', () => {
  describe('getViewTransitionName', () => {
    it('generates a sanitized custom-ident for active issues', () => {
      expect(getViewTransitionName('PROJ-101', false)).toBe('issue-proj-101');
      expect(getViewTransitionName('TASK-456', false)).toBe('issue-task-456');
    });

    it('generates a distinct custom-ident for done issues', () => {
      expect(getViewTransitionName('PROJ-101', true)).toBe('issue-done-proj-101');
      expect(getViewTransitionName('TASK-456', true)).toBe('issue-done-task-456');
    });

    it('sanitizes special characters into safe css identifier characters', () => {
      expect(getViewTransitionName('PROJ.101:sub', false)).toBe('issue-proj-101-sub');
    });
  });

  describe('runWithViewTransition', () => {
    let originalStartViewTransition: unknown;

    beforeEach(() => {
      originalStartViewTransition = (document as unknown as { startViewTransition?: unknown }).startViewTransition;
    });

    afterEach(() => {
      if (originalStartViewTransition !== undefined) {
        (document as unknown as { startViewTransition: unknown }).startViewTransition = originalStartViewTransition;
      } else {
        delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;
      }
    });

    it('calls document.startViewTransition when available', () => {
      const mockStartViewTransition = vi.fn((cb: () => void) => {
        cb();
        return { finished: Promise.resolve() };
      });
      (document as unknown as { startViewTransition: unknown }).startViewTransition = mockStartViewTransition;

      const callback = vi.fn();
      runWithViewTransition(callback);

      expect(mockStartViewTransition).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('falls back to direct callback execution when startViewTransition is unsupported', () => {
      delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;

      const callback = vi.fn();
      runWithViewTransition(callback);

      expect(callback).toHaveBeenCalledTimes(1);
    });
  });
});
