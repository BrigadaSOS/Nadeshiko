/** @type {import('tailwindcss').Config} */
import preline from 'preline/plugin';

export default {
  darkMode: ["class"],
  safelist: ["dark"],
  prefix: "",
  content: [
    './node_modules/preline/preline.js',
    './content/**/*.md'],
  theme: {
    container: {
      center: true,
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        background: "var(--background)",
        header: {
          background: "var(--header-background)"
        },
        footer: {
          background: "var(--footer-background)"
        },
        button: {
          primary: {
            main: "var(--button-color-primary)",
            hover: "var(--button-color-hover-primary)"
          },
          danger:{
            main: "var(--button-color-danger)",
            hover: "var(--button-color-danger-hover)"
          }
        },
        input:{
          background: "var(--input-background)"
        },
        card:{
          background: "var(--card-background)"
        },
        modal:{
          background: "var(--modal-background)",
          input: "var(--modal-input)",
          border: "var(--modal-border)"
        }
      }
    },
  },
  plugins: [preline]
}