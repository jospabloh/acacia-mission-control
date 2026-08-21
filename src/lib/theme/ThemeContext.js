import { createContext } from 'react';

/**
 * Theme state, split across three files the same way lib/auth is — context
 * here, provider in ThemeProvider.jsx, hook in useTheme.js. Exporting a hook
 * and a component from one file breaks react-refresh, and this repo's lint
 * treats that as a warning it does not want to carry.
 */
export const THEME_STORAGE_KEY = 'acacia-mc-theme';
export const THEME_MODES = ['light', 'dark', 'system'];

export const ThemeContext = createContext({
  mode: 'system',
  resolvedTheme: 'light',
  setMode: () => {},
});
