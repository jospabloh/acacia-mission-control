import { useCallback, useEffect, useMemo, useState } from 'react';
import { ThemeContext, THEME_MODES, THEME_STORAGE_KEY } from './ThemeContext.js';

/**
 * Three modes, not two: 'light' | 'dark' | 'system'. What gets stored is the
 * operator's *preference*; 'system' keeps resolving against the OS for as long
 * as it is selected, so a laptop that turns dark at sunset turns the console
 * dark with it — no reload, no second setting to remember.
 *
 * index.html carries a pre-mount copy of this same resolution so the very first
 * paint is already the right colour. The two are kept in sync by hand — both
 * sides carry a comment pointing at the other.
 */

function readStoredMode() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (THEME_MODES.includes(stored)) return stored;
  } catch { /* private mode — fall through to following the device */ }
  return 'system';
}

function prefersDark() {
  try {
    return Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  } catch { return false; }
}

export function ThemeProvider({ children }) {
  const [mode, setModeState] = useState(() => (typeof window === 'undefined' ? 'system' : readStoredMode()));
  const [systemDark, setSystemDark] = useState(() => (typeof window === 'undefined' ? false : prefersDark()));

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event) => setSystemDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const resolvedTheme = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', resolvedTheme === 'dark');
    // Keeps native controls (scrollbars, date pickers, selects) in step with
    // the page instead of staying stubbornly light.
    root.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  useEffect(() => {
    try { localStorage.setItem(THEME_STORAGE_KEY, mode); } catch { /* private mode — preference is session-only */ }
  }, [mode]);

  const setMode = useCallback((next) => setModeState(THEME_MODES.includes(next) ? next : 'system'), []);

  const value = useMemo(() => ({ mode, resolvedTheme, setMode }), [mode, resolvedTheme, setMode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
