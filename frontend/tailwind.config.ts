import type { Config } from "tailwindcss";

/*
 * Design tokens live as CSS variables in app/globals.css; the semantic names
 * below are thin aliases so components can read `bg-panel`, `text-gold`, etc.
 * Raw hex values from the mockups are still available via Tailwind's arbitrary
 * value syntax where a one-off shade is needed.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        arabic: ["var(--font-arabic)", "serif"],
      },
      colors: {
        bg: "var(--bg)",
        panel: "var(--bg-panel)",
        raised: "var(--bg-raised)",
        "raised-2": "var(--bg-raised-2)",
        line: "var(--line)",
        "line-strong": "var(--line-strong)",
        ink: "var(--ink)",
        gold: "var(--gold)",
        "gold-bright": "var(--gold-bright)",
        live: "var(--live)",
        ok: "var(--ok)",
      },
    },
  },
  plugins: [],
};

export default config;
