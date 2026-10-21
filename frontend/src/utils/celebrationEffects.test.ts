import { describe, it, expect, vi, beforeEach } from 'vitest';
import confetti from 'canvas-confetti';
import {
  triggerDoneCelebration,
  CELEBRATION_TYPES,
} from './celebrationEffects.ts';

vi.mock('canvas-confetti', () => {
  const mockConfetti = vi.fn();
  (mockConfetti as any).shapeFromText = vi.fn((text: string) => ({ type: 'text', text }));
  return {
    default: mockConfetti,
  };
});

describe('celebrationEffects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    // Default: reduced motion false
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  it('exposes all 4 planned celebration types', () => {
    expect(CELEBRATION_TYPES).toEqual([
      'dual-cannon',
      'fireworks',
      'star-emoji',
      'rainbow-cascade',
    ]);
  });

  it('triggers dual-cannon celebration correctly with prominent visibility and high z-index', () => {
    triggerDoneCelebration({ forcedType: 'dual-cannon' });
    expect(confetti).toHaveBeenCalled();
    const calls = (confetti as unknown as ReturnType<typeof vi.fn>).mock.calls;
    // Dual cannon fires from left and right with high zIndex and prominent scalar
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const origins = calls.map((c) => c[0]?.origin?.x);
    expect(origins.some((x: number) => x < 0.3)).toBe(true);
    expect(origins.some((x: number) => x > 0.7)).toBe(true);
    expect(calls[0][0]?.zIndex).toBe(99999);
    expect(calls[0][0]?.scalar).toBeGreaterThanOrEqual(1.2);
  });

  it('triggers star-emoji celebration correctly with custom text/star shapes and large scalar', () => {
    triggerDoneCelebration({ forcedType: 'star-emoji' });
    expect(confetti).toHaveBeenCalled();
    expect((confetti as any).shapeFromText).toHaveBeenCalled();
    const calls = (confetti as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some((c) => c[0]?.scalar >= 2.5)).toBe(true);
  });

  it('triggers rainbow-cascade celebration with spread, gravity, and high visibility', () => {
    triggerDoneCelebration({ forcedType: 'rainbow-cascade' });
    expect(confetti).toHaveBeenCalled();
    const firstCall = (confetti as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(firstCall.origin.y).toBeLessThanOrEqual(0.1);
    expect(firstCall.zIndex).toBe(99999);
    expect(firstCall.scalar).toBeGreaterThanOrEqual(1.3);
  });

  it('triggers fireworks celebration with multiple timed bursts', () => {
    vi.useFakeTimers();
    try {
      triggerDoneCelebration({ forcedType: 'fireworks' });
      expect(confetti).toHaveBeenCalled();
      const initialCalls = (confetti as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
      vi.advanceTimersByTime(500);
      expect((confetti as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(initialCalls);
    } finally {
      vi.useRealTimers();
    }
  });

  it('randomly selects one of the 4 celebration types when forcedType is not specified', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.26); // Should pick index 1
    const chosen = triggerDoneCelebration();
    expect(chosen).toBe('fireworks');
    expect(confetti).toHaveBeenCalled();
  });

  it('does not trigger heavy animations if prefers-reduced-motion is enabled', () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const result = triggerDoneCelebration();
    expect(result).toBeNull();
    expect(confetti).not.toHaveBeenCalled();
  });
});
