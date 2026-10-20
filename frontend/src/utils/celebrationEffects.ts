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
  const colors = ['#ff0055', '#00e5ff', '#ffeb3b', '#00e676', '#e040fb', '#ff9100'];

  // Left cannon
  confetti({
    particleCount: 90,
    angle: 60,
    spread: 70,
    startVelocity: 55,
    scalar: 1.25,
    origin: { x: 0, y: 0.8 },
    zIndex: 99999,
    colors,
  });

  // Right cannon
  confetti({
    particleCount: 90,
    angle: 120,
    spread: 70,
    startVelocity: 55,
    scalar: 1.25,
    origin: { x: 1, y: 0.8 },
    zIndex: 99999,
    colors,
  });

  // Second delayed mini-burst of stars towards the center
  setTimeout(() => {
    confetti({
      particleCount: 50,
      angle: 90,
      spread: 100,
      startVelocity: 45,
      scalar: 1.4,
      origin: { x: 0.5, y: 0.7 },
      zIndex: 99999,
      colors: ['#ffd700', '#ffea00', '#ffffff'],
    });
  }, 180);
}

function launchFireworks(): void {
  const duration = 1800;
  const animationEnd = Date.now() + duration;
  const defaults = {
    startVelocity: 35,
    spread: 360,
    ticks: 80,
    scalar: 1.3,
    zIndex: 99999,
    colors: ['#ff1744', '#00e5ff', '#ffea00', '#00e676', '#d500f9', '#ff9100'],
  };

  function randomInRange(min: number, max: number) {
    return Math.random() * (max - min) + min;
  }

  // Initial immediate vibrant double burst
  confetti({
    ...defaults,
    particleCount: 60,
    origin: { x: randomInRange(0.15, 0.45), y: Math.random() * 0.25 + 0.2 },
  });
  confetti({
    ...defaults,
    particleCount: 60,
    origin: { x: randomInRange(0.55, 0.85), y: Math.random() * 0.25 + 0.2 },
  });

  const interval: ReturnType<typeof setInterval> = setInterval(() => {
    const timeLeft = animationEnd - Date.now();

    if (timeLeft <= 0) {
      clearInterval(interval);
      return;
    }

    const particleCount = Math.floor(55 * (timeLeft / duration)) + 25;
    confetti({
      ...defaults,
      particleCount,
      origin: { x: randomInRange(0.1, 0.9), y: Math.random() * 0.35 + 0.15 },
    });
  }, 220);
}

function launchStarEmojiFiesta(): void {
  const emojis = ['⭐', '🎉', '✨', '🏆', '🎈', '🥳', '🚀'];
  const emojiShapes =
    typeof confetti.shapeFromText === 'function'
      ? emojis.map((char) => confetti.shapeFromText(char))
      : [];

  const shapes = emojiShapes.length > 0 ? (emojiShapes as any) : ['star', 'circle'];

  // Giant joyous emoji explosion
  confetti({
    particleCount: 50,
    spread: 100,
    startVelocity: 45,
    origin: { y: 0.55 },
    shapes,
    scalar: 2.8,
    ticks: 160,
    zIndex: 99999,
  });

  // Layered with bright golden sparkle particles
  confetti({
    particleCount: 80,
    spread: 120,
    startVelocity: 50,
    origin: { y: 0.55 },
    scalar: 1.2,
    ticks: 140,
    zIndex: 99999,
    colors: ['#ffd700', '#ff69b4', '#00e5ff', '#76ff03', '#ff9100', '#ff007f'],
  });
}

function launchRainbowCascade(): void {
  const colors = [
    '#ff0033', // intense red
    '#ff6600', // vibrant orange
    '#ffea00', // bright yellow
    '#00e676', // lime green
    '#00b0ff', // sky blue
    '#2979ff', // royal blue
    '#d500f9', // neon purple
  ];

  // Wide top shower
  confetti({
    particleCount: 140,
    spread: 160,
    origin: { y: 0 },
    gravity: 0.75,
    ticks: 250,
    scalar: 1.35,
    zIndex: 99999,
    colors,
  });

  // Second wave with larger fluttering streamers
  setTimeout(() => {
    confetti({
      particleCount: 80,
      spread: 140,
      origin: { y: 0.05 },
      gravity: 0.65,
      ticks: 280,
      scalar: 1.5,
      zIndex: 99999,
      colors,
    });
  }, 200);
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
