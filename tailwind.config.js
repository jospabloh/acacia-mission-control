/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // ACACIA brand-ish neutrals
        acacia: {
          50: '#f4f6f8',
          100: '#e7ebf0',
          500: '#5b6b7b',
          700: '#37424d',
          900: '#1b2128',
        },
      },
    },
  },
  plugins: [],
}
