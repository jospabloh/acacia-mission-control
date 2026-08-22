import { useContext } from 'react';
import { ThemeContext } from './ThemeContext.js';

/**
 * `mode` is the operator's stored preference — 'light' | 'dark' | 'system'.
 * `resolvedTheme` is the colour actually on screen. Read `mode` to show what
 * they chose, `resolvedTheme` to know what they are looking at.
 */
export function useTheme() {
  return useContext(ThemeContext);
}
