import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "../../packages/ui/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          black: "#111111",
          red: "#E53935",
          gray: "#F5F5F5"
        }
      }
    },
  },
  plugins: [],
};

export default config;
