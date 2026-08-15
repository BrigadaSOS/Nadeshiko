/** @type {import('tailwindcss').Config} */

export default {
  darkMode: ['class'],
  safelist: ['dark'],
  prefix: '',
  content: ['./app/**/*.{js,ts,vue}', './content/**/*.md'],
  theme: {
    container: {
      center: true,
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      screens: {
        '3xl': '1920px',
      },
      colors: {
        background: 'var(--background)',
        surface: {
          DEFAULT: 'var(--surface)',
          soft: 'var(--surface-soft)',
          lift: 'var(--surface-lift)',
        },
        hairline: 'var(--line)',
        ink: {
          DEFAULT: 'var(--ink)',
          muted: 'var(--ink-muted)',
          faint: 'var(--ink-faint)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          soft: 'var(--accent-soft)',
        },
        control: {
          DEFAULT: 'var(--control)',
          hover: 'var(--control-hover)',
        },
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
          accent: {
            main: 'var(--button-color-accent)',
            hover: 'var(--button-color-accent-hover)',
          },
        },
        input: {
          background: 'var(--input-background)',
          'focus-ring': 'var(--input-focus-ring)',
        },
        card: {
          background: 'var(--card-background)',
        },
        modal: {
          background: 'var(--modal-background)',
          input: 'var(--modal-input)',
          border: 'var(--modal-border)',
        },
        // Legacy class names still used in a few older templates.
        sgray: 'var(--control)',
        sgray2: 'var(--control-hover)',
        sgrayhover: 'var(--control-hover)',
        sred: 'var(--accent)',
      },
    },
  },
  plugins: [],
};
