/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ["'Space Grotesk'", 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ["'DM Sans'", 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Neutral slate scale used by the inner app (layout, nav, pages).
        acacia: {
          50: '#f4f6f8',
          100: '#e7ebf0',
          500: '#5b6b7b',
          700: '#37424d',
          900: '#1b2128',
        },
        // ACACIA brand (from acaciaco.com.mx)
        ink: {
          DEFAULT: '#0e0d14',
          soft: 'rgba(14,13,20,0.62)',
          mute: 'rgba(14,13,20,0.42)',
          faint: 'rgba(14,13,20,0.22)',
        },
        paper: {
          DEFAULT: '#f7f6f2', // warm off-white site background
          card: '#ffffff',
          subtle: '#efefea',
        },
        brand: {
          // --primary: oklch(62% 0.22 248) ≈ #3b6ef8 (the "ac" monogram blue)
          DEFAULT: '#3b6ef8',
          bright: '#5b86ff',
          deep: '#2b56d4',
        },
      },
      boxShadow: {
        card: '0 1px 2px rgba(14,13,20,0.04), 0 12px 40px -12px rgba(14,13,20,0.18)',
        glow: '0 0 0 1px rgba(59,110,248,0.12), 0 18px 60px -20px rgba(59,110,248,0.45)',
      },
      borderColor: {
        hair: 'rgba(14,13,20,0.08)',
      },
    },
  },
  plugins: [],
}
