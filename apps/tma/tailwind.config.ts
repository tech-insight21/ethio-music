import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        accent: "var(--tg-accent)",
        card: "var(--tg-card)",
      },
    },
  },
  plugins: [],
};

export default config;
