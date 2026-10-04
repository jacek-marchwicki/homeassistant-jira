/**
 * Theme Bridge utility for managing dark, light, and kiosk modes,
 * and bridging Home Assistant theme changes dynamically.
 */

export type ThemeMode = 'dark' | 'light' | 'kiosk';

const THEME_STORAGE_KEY = 'ha_jira_theme_mode';

export function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'dark';
  
  // Check local storage preference
  const saved = localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null;
  if (saved && ['dark', 'light', 'kiosk'].includes(saved)) {
    return saved;
  }

  // Default is dark (optimized for wallboards and HA dashboards)
  return 'dark';
}

export function applyTheme(theme: ThemeMode): void {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  if (theme === 'dark') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', theme);
  }

  localStorage.setItem(THEME_STORAGE_KEY, theme);
}

/**
 * Checks if the app is currently running inside Home Assistant Ingress or iframe.
 */
export function isRunningInHomeAssistant(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top || window.location.pathname.includes('/hassio_ingress/');
  } catch {
    return true; // If access is restricted by iframe sandbox, it is framed
  }
}
