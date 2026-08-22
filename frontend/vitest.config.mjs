import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

/* Vitest for the Vault frontend. jsdom gives the pure-logic modules a real
 * localStorage/File/DOM to run against; the "@/" alias mirrors jsconfig so
 * imports resolve the same way they do under Next. */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    // jsdom disables localStorage under an opaque origin, so give it a real
    // http URL — the vault modules read and write localStorage everywhere.
    environmentOptions: { jsdom: { url: "http://localhost/" } },
    globals: true,
    setupFiles: ["./vitest.setup.js"],
    include: ["**/*.{test,spec}.{js,jsx}"],
    exclude: ["node_modules/**", ".next/**"],
  },
});
