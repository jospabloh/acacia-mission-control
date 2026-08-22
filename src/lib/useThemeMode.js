import { useTheme } from './theme/useTheme.js';

/**
 * Adapter between this app's theme state and the portfolio's shared
 * <ThemeSwitcher />. The switcher is byte-identical across every ACACIA app,
 * so each app supplies this one file to say where its theme state lives.
 */
export function useThemeMode() {
  const { mode, setMode } = useTheme();
  return { mode, setMode };
}
