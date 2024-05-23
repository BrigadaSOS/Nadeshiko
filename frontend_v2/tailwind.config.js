const animate = require("tailwindcss-animate")

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  safelist: ["dark"],
  prefix: "",
  content: [
    './node_modules/preline/preline.js',],
  theme: {
    container: {
      center: true,
      padding: "2rem",
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
          }
        },
        input:{
          background: "var(--input-background)"
        },
        card:{
          background: "var(--card-background)"
        }
      }
    },
  },
  plugins: [animate, require('preline/plugin')],
}