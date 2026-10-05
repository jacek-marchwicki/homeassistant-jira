#!/usr/bin/env node
/**
 * PWA Icon Generator for Home Assistant Jira Dashboard.
 * Generates crisp SVG, PNG, and Android maskable icons at standard PWA resolutions.
 *
 * Requirements: Node.js, @playwright/test (available in frontend workspace)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const frontendDir = path.join(projectRoot, 'frontend');
const publicDir = path.join(frontendDir, 'public');

// Resolve playwright from frontend node_modules
const require = createRequire(path.join(frontendDir, 'package.json'));
const { chromium } = require('@playwright/test');

/**
 * Builds the SVG markup for the Jira Dashboard icon.
 * @param {Object} options
 * @param {boolean} options.isMaskable - Whether to add safe zone padding for Android adaptive icons.
 */
export function createSvg({ isMaskable = false } = {}) {
  // Safe zone for Android maskable icons: keep graphics within center 80% circle
  const scale = isMaskable ? 14 : 16;
  const tx = (512 - 24 * scale) / 2;
  const ty = (512 - 24 * scale) / 2;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bg-grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0f172a" />
      <stop offset="50%" stop-color="#1e293b" />
      <stop offset="100%" stop-color="#0f172a" />
    </linearGradient>
    <linearGradient id="layer-grad-top" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#60a5fa" />
      <stop offset="100%" stop-color="#3b82f6" />
    </linearGradient>
    <linearGradient id="layer-grad-mid" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#38bdf8" />
      <stop offset="100%" stop-color="#2563eb" />
    </linearGradient>
    <linearGradient id="layer-grad-bot" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#2563eb" />
      <stop offset="100%" stop-color="#1d4ed8" />
    </linearGradient>
    <radialGradient id="halo" cx="50%" cy="45%" r="40%">
      <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.35" />
      <stop offset="100%" stop-color="#3b82f6" stop-opacity="0" />
    </radialGradient>
  </defs>

  <!-- Background -->
  <rect width="512" height="512" fill="url(#bg-grad)" />

  <!-- Subtle glow halo behind icon -->
  <circle cx="256" cy="240" r="190" fill="url(#halo)" />

  <!-- Decorative subtle rounded border for standalone preview -->
  ${
    !isMaskable
      ? '<rect x="4" y="4" width="504" height="504" rx="110" fill="none" stroke="#334155" stroke-width="4" opacity="0.6" />'
      : ''
  }

  <!-- Scaled centered Layers icon -->
  <g transform="translate(${tx}, ${ty}) scale(${scale})">
    <!-- Top Layer (diamond) -->
    <path
      d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"
      fill="url(#layer-grad-top)"
      stroke="#93c5fd"
      stroke-width="0.6"
      stroke-linejoin="round"
    />
    <!-- Middle Layer -->
    <path
      d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"
      fill="none"
      stroke="url(#layer-grad-mid)"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <!-- Bottom Layer -->
    <path
      d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"
      fill="none"
      stroke="url(#layer-grad-bot)"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </g>
</svg>`;
}

async function main() {
  console.log('Generating PWA icons for Jira Dashboard...');

  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  // 1. Generate SVGs
  const standardSvg = createSvg({ isMaskable: false });
  const maskableSvg = createSvg({ isMaskable: true });

  fs.writeFileSync(path.join(publicDir, 'favicon.svg'), standardSvg);
  fs.writeFileSync(path.join(publicDir, 'icon-maskable.svg'), maskableSvg);
  console.log('✓ Saved SVG icons (favicon.svg, icon-maskable.svg)');

  // 2. Render PNGs using headless Chromium
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const targets = [
    { filename: 'pwa-192x192.png', size: 192, svg: standardSvg },
    { filename: 'pwa-512x512.png', size: 512, svg: standardSvg },
    { filename: 'pwa-maskable-192x192.png', size: 192, svg: maskableSvg },
    { filename: 'pwa-maskable-512x512.png', size: 512, svg: maskableSvg },
    { filename: 'apple-touch-icon.png', size: 180, svg: standardSvg },
  ];

  for (const { filename, size, svg } of targets) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<!DOCTYPE html>
<html>
  <head>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${size}px; height: ${size}px; overflow: hidden; background: transparent; }
      svg { width: ${size}px; height: ${size}px; display: block; }
    </style>
  </head>
  <body>${svg}</body>
</html>`);

    const outPath = path.join(publicDir, filename);
    await page.screenshot({ path: outPath, type: 'png' });
    console.log(`✓ Rendered ${filename} (${size}x${size}px)`);
  }

  await browser.close();

  // 3. Ensure screenshot directory and samples exist
  const screenshotsDir = path.join(publicDir, 'screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  const testScreenshots = path.join(frontendDir, 'tests', 'screenshots');
  const mobileSrc = path.join(testScreenshots, 'mobile-375x667.png');
  const desktopSrc = path.join(testScreenshots, 'desktop-dark.png');

  if (fs.existsSync(mobileSrc)) {
    fs.copyFileSync(mobileSrc, path.join(screenshotsDir, 'mobile.png'));
  }
  if (fs.existsSync(desktopSrc)) {
    fs.copyFileSync(desktopSrc, path.join(screenshotsDir, 'desktop.png'));
  }

  console.log('🎉 All PWA icons and assets successfully generated!');
}

main().catch((err) => {
  console.error('Error generating icons:', err);
  process.exit(1);
});
