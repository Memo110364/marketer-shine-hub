// Standalone Vite config for the static-hosting build (Bluehost, or any
// plain file host with no Node.js). Deliberately does NOT use
// @lovable.dev/vite-tanstack-config / tanstackStart() — this is a plain
// client-only React build (see src/entry-static.tsx for why).
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [react(), tailwindcss(), tsconfigPaths()],
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    rollupOptions: {
      input: "index.static.html",
    },
  },
});
