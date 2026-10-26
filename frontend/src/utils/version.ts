/**
 * Application version metadata.
 * __APP_VERSION__ is injected at build and test time from package.json via Vite's `define`.
 */
declare const __APP_VERSION__: string | undefined;

export const APP_VERSION: string =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.9.1';
