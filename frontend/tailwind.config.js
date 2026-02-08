/** @type {import('tailwindcss').Config} */

export default {
  darkMode: ['class'],
  safelist: ['dark'],
  prefix: '',
  content: [
    './app/**/*.{js,ts,vue}',
    './components/**/*.{js,ts,vue}',
    './layouts/**/*.vue',
    './pages/**/*.vue',
    './plugins/**/*.{js,ts}',
    './composables/**/*.{js,ts}',
    './utils/**/*.{js,ts}',
    './content/**/*.md',
  ],
  theme: {
    container: {
      center: true,
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      colors: {
        background: 'var(--background)',
        header: {
          background: 'var(--header-background)',
        },
        footer: {
          background: 'var(--footer-background)',
        },
        button: {
          primary: {
            main: 'var(--button-color-primary)',
            hover: 'var(--button-color-hover-primary)',
          },
          danger: {
            main: 'var(--button-color-danger)',
            hover: 'var(--button-color-danger-hover)',
          },
        },
        input: {
          background: 'var(--input-background)',
        },
        card: {
          background: 'var(--card-background)',
        },
        modal: {
          background: 'var(--modal-background)',
          input: 'var(--modal-input)',
          border: 'var(--modal-border)',
        },
      },
    },
  },
  plugins: [],
};
