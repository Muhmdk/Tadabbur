import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // TODO: load an Arabic font (e.g. Noto Naskh Arabic) and wire it here.
        arabic: ["var(--font-arabic)", "serif"],
      },
    },
  },
  plugins: [],
};

export default config;
