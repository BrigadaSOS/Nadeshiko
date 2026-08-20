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
          // `--surface-hover` has existed as a token all along; it just had no
          // entry here, so `hover:bg-surface-hover` generated no CSS and the
          // magic-link buttons in `ModalLoginSignUp` had no hover state at all.
          // Nothing errors on a missing colour key -- Tailwind simply emits
          // nothing -- which is why it sat unnoticed. `accent` already carries a
          // `hover`, so this is the shape the palette was assumed to have.
          hover: 'var(--surface-hover)',
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
