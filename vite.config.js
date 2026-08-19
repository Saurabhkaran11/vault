import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" makes the built site work on GitHub Pages at any repo name
// server.port honors the PORT env var so launchers can assign any free port
export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    strictPort: false,
  },
});
