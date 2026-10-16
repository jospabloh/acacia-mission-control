/** @type {import('tailwindcss').Config} */
//
// Colours are CSS variables defined in src/index.css, not literals. `.dark` on
// <html> re-points those variables, so every existing `bg-paper-card` /
// `text-ink-mute` / `border-hair` in the app switches theme without a single
// `dark:` variant. Add new colours the same way — a hex committed here is a
// colour that will not follow the theme.
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ["'Space Grotesk'", 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ["'DM Sans'", 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Neutral ramp used by the inner app (layout, nav, pages).
        acacia: {
          50: 'rgb(var(--acacia-50) / <alpha-value>)',
          100: 'rgb(var(--acacia-100) / <alpha-value>)',
          500: 'rgb(var(--acacia-500) / <alpha-value>)',
          700: 'rgb(var(--acacia-700) / <alpha-value>)',
          900: 'rgb(var(--acacia-900) / <alpha-value>)',
        },
        // ACACIA brand (from acaciaco.com.mx)
        ink: {
          DEFAULT: 'rgb(var(--ink) / <alpha-value>)',
          soft: 'rgb(var(--ink) / 0.62)',
          mute: 'rgb(var(--ink) / 0.42)',
          faint: 'rgb(var(--ink) / 0.22)',
        },
        paper: {
          DEFAULT: 'rgb(var(--paper) / <alpha-value>)',
          card: 'rgb(var(--paper-card) / <alpha-value>)',
          subtle: 'rgb(var(--paper-subtle) / <alpha-value>)',
        },
        brand: {
          DEFAULT: 'rgb(var(--brand) / <alpha-value>)',
          bright: 'rgb(var(--brand-bright) / <alpha-value>)',
          deep: 'rgb(var(--brand-deep) / <alpha-value>)',
        },
        // Aliases the shared portfolio <ThemeSwitcher /> is written against, so
        // that one component stays byte-identical across every ACACIA app
        // whether the app is on shadcn tokens or on this console's own.
        background: 'rgb(var(--paper) / <alpha-value>)',
        foreground: 'rgb(var(--ink) / <alpha-value>)',
        card: 'rgb(var(--paper-card) / <alpha-value>)',
        border: 'var(--hair)',
        primary: 'rgb(var(--brand) / <alpha-value>)',
        // Label colour on a `bg-primary` fill. The shared <UpdateBanner /> (Module 30)
        // draws its *Actualizar* button with it; without the alias Tailwind drops
        // the class and the label inherits ink — dark text on brand blue.
        'primary-foreground': 'rgb(var(--brand-foreground) / <alpha-value>)',
        ring: 'rgb(var(--brand) / <alpha-value>)',
        // Module 29's shared <AppShell /> also draws with these three: `accent` is
        // the hover / active-item fill (the nav's old paper-subtle), `popover` the
        // account menu's surface. Aliases of existing variables, so both themes
        // come for free.
        accent: 'rgb(var(--paper-subtle) / <alpha-value>)',
        popover: 'rgb(var(--paper-card) / <alpha-value>)',
        'popover-foreground': 'rgb(var(--ink) / <alpha-value>)',
        'muted-foreground': 'rgb(var(--ink) / 0.55)',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        glow: 'var(--shadow-glow)',
      },
      borderColor: {
        hair: 'var(--hair)',
      },
    },
  },
  plugins: [],
}
