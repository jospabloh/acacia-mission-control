import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // `@` -> src, matching every other app in the portfolio. The shared
  // <ThemeSwitcher /> is copied between repos byte for byte and imports its
  // adapter as '@/lib/useThemeMode', so this alias is what lets it stay
  // identical here.
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5173 },
  build: { outDir: 'dist', sourcemap: false },
})
