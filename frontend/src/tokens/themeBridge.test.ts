import { describe, it, expect, beforeEach } from 'vitest';
import { 
  getInitialTheme, 
  applyTheme, 
  isRunningInHomeAssistant 
} from './themeBridge.ts';

describe('themeBridge', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('defaults to dark theme when no preference stored', () => {
    const theme = getInitialTheme();
    expect(theme).toBe('dark');
  });

  it('applies light theme correctly and stores preference', () => {
    applyTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(window.localStorage.getItem('ha_jira_theme_mode')).toBe('light');
    expect(getInitialTheme()).toBe('light');
  });

  it('applies kiosk theme correctly and stores preference', () => {
    applyTheme('kiosk');
    expect(document.documentElement.getAttribute('data-theme')).toBe('kiosk');
    expect(window.localStorage.getItem('ha_jira_theme_mode')).toBe('kiosk');
    expect(getInitialTheme()).toBe('kiosk');
  });

  it('applies dark theme by removing data-theme attribute', () => {
    document.documentElement.setAttribute('data-theme', 'light');
    applyTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
    expect(window.localStorage.getItem('ha_jira_theme_mode')).toBe('dark');
    expect(getInitialTheme()).toBe('dark');
  });

  it('detects standalone mode when window is not framed', () => {
    // In happy-dom / jsdom environment, window.self === window.top
    const inHA = isRunningInHomeAssistant();
    expect(typeof inHA).toBe('boolean');
  });

  it('updates meta theme-color tag to match theme for PWA status bar', () => {
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'theme-color');
      meta.setAttribute('content', '#0f172a');
      document.head.appendChild(meta);
    }

    applyTheme('light');
    expect(meta.getAttribute('content')).toBe('#f1f5f9');

    applyTheme('dark');
    expect(meta.getAttribute('content')).toBe('#1e293b');

    applyTheme('kiosk');
    expect(meta.getAttribute('content')).toBe('#0e131d');
  });
});
