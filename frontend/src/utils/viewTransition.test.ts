import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getViewTransitionName, runWithViewTransition } from './viewTransition.ts';

describe('viewTransition utility', () => {
  describe('getViewTransitionName', () => {
    it('generates a sanitized custom-ident for active issues', () => {
      expect(getViewTransitionName('PROJ-101')).toBe('issue-proj-101');
      expect(getViewTransitionName('PROJ-101', false)).toBe('issue-proj-101');
      expect(getViewTransitionName('TASK-456', false)).toBe('issue-task-456');
    });

    it('maintains a stable custom-ident for done issues to avoid disappearing background during transitions', () => {
      expect(getViewTransitionName('PROJ-101', true)).toBe('issue-proj-101');
      expect(getViewTransitionName('TASK-456', true)).toBe('issue-task-456');
    });

    it('sanitizes special characters into safe css identifier characters', () => {
      expect(getViewTransitionName('PROJ.101:sub', false)).toBe('issue-proj-101-sub');
    });

    it('scopes transition names to column id to prevent duplicate identifiers across people columns', () => {
      expect(getViewTransitionName('PROJ-101', false, 'col-jacek')).toBe('issue-col-jacek-proj-101');
      expect(getViewTransitionName('PROJ-101', true, 'col-jacek')).toBe('issue-col-jacek-proj-101');
      expect(getViewTransitionName('PROJ-101', 'col-jacek')).toBe('issue-col-jacek-proj-101');
      expect(getViewTransitionName('PROJ-101', false, 'col-magda')).toBe('issue-col-magda-proj-101');
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

  describe('theme.css View Transition rules', () => {
    it('does not disable view-transition-name on :root to protect Android WebView iframe rendering', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const cssPath = path.resolve(__dirname, '../tokens/theme.css');
      const cssContent = fs.readFileSync(cssPath, 'utf-8');

      // :root { view-transition-name: none; } causes Android WebView iframes to flash pitch black
      expect(cssContent).not.toMatch(/:root\s*\{\s*view-transition-name:\s*none;?\s*\}/);
    });

    it('suppresses root animation and card snapshot fade-out animations to prevent blinking', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const cssPath = path.resolve(__dirname, '../tokens/theme.css');
      const cssContent = fs.readFileSync(cssPath, 'utf-8');

      // Root view transition old and new must have animation: none !important
      expect(cssContent).toMatch(/::view-transition-old\(root\),\s*::view-transition-new\(root\)\s*\{\s*animation:\s*none\s*!important;\s*\}/);

      // Card view transition old and new must have animation: none !important to prevent disappearing background
      expect(cssContent).toMatch(/::view-transition-old\(\*\),\s*::view-transition-new\(\*\)\s*\{\s*animation:\s*none\s*!important;\s*\}/);

      // Must not define opacity-zero fade-out keyframes for cards
      expect(cssContent).not.toContain('vt-card-fade-out');
    });
  });
});
