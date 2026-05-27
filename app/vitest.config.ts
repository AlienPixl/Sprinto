import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./vitest.setup.ts",
    env: { PORT: "0" },
    coverage: {
      reporter: ["text", "lcov"],
    },
  },
});
