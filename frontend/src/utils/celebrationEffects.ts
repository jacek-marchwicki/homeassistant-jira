import confetti from 'canvas-confetti';

export type CelebrationAnimationType =
  | 'dual-cannon'
  | 'fireworks'
  | 'star-emoji'
  | 'rainbow-cascade';

export const CELEBRATION_TYPES: CelebrationAnimationType[] = [
  'dual-cannon',
  'fireworks',
  'star-emoji',
  'rainbow-cascade',
];

function isReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function launchDualCannon(): void {
  // Left cannon
  confetti({
    particleCount: 60,
    angle: 60,
    spread: 65,
    origin: { x: 0, y: 0.85 },
    colors: ['#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'],
  });
  // Right cannon
  confetti({
    particleCount: 60,
    angle: 120,
    spread: 65,
    origin: { x: 1, y: 0.85 },
    colors: ['#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'],
  });
}

function launchFireworks(): void {
  const duration = 1200;
  const animationEnd = Date.now() + duration;
  const defaults = { startVelocity: 25, spread: 360, ticks: 60, zIndex: 9999 };

  function randomInRange(min: number, max: number) {
    return Math.random() * (max - min) + min;
  }

  // Initial immediate burst
  confetti({
    ...defaults,
    particleCount: 40,
    origin: { x: randomInRange(0.2, 0.4), y: Math.random() * 0.3 + 0.2 },
  });

  const interval: ReturnType<typeof setInterval> = setInterval(() => {
    const timeLeft = animationEnd - Date.now();

    if (timeLeft <= 0) {
      clearInterval(interval);
      return;
    }

    const particleCount = 40 * (timeLeft / duration);
    confetti({
      ...defaults,
      particleCount,
      origin: { x: randomInRange(0.1, 0.9), y: Math.random() * 0.4 + 0.1 },
    });
  }, 250);
}

function launchStarEmojiFiesta(): void {
  const emojiShapes =
    typeof confetti.shapeFromText === 'function'
      ? ['⭐', '🎉', '✨', '🏆', '🎈'].map((char) => confetti.shapeFromText(char))
      : [];

  const shapes = emojiShapes.length > 0 ? (emojiShapes as any) : ['star', 'circle'];

  confetti({
    particleCount: 75,
    spread: 90,
    origin: { y: 0.6 },
    shapes,
    scalar: 1.5,
    colors: ['#ffd700', '#ff69b4', '#00e5ff', '#76ff03', '#ff9100'],
  });
}

function launchRainbowCascade(): void {
  confetti({
    particleCount: 100,
    spread: 120,
    origin: { y: 0.05 },
    gravity: 0.8,
    ticks: 200,
    colors: [
      '#ef4444', // red
      '#f97316', // orange
      '#eab308', // yellow
      '#22c55e', // green
      '#06b6d4', // cyan
      '#3b82f6', // blue
      '#a855f7', // purple
    ],
  });
}

export interface TriggerCelebrationOptions {
  forcedType?: CelebrationAnimationType;
}

/**
 * Triggers a kid-friendly celebratory confetti animation chosen randomly
 * from the four supported celebration types.
 *
 * Returns the selected animation type, or null if suppressed by reduced-motion settings.
 */
export function triggerDoneCelebration(
  options: TriggerCelebrationOptions = {}
): CelebrationAnimationType | null {
  if (isReducedMotion()) {
    return null;
  }

  const selectedType =
    options.forcedType ||
    CELEBRATION_TYPES[Math.floor(Math.random() * CELEBRATION_TYPES.length)];

  switch (selectedType) {
    case 'dual-cannon':
      launchDualCannon();
      break;
    case 'fireworks':
      launchFireworks();
      break;
    case 'star-emoji':
      launchStarEmojiFiesta();
      break;
    case 'rainbow-cascade':
      launchRainbowCascade();
      break;
  }

  return selectedType;
}
