// Standalone Vite config for the static-hosting build (Bluehost, or any
// plain file host with no Node.js). Deliberately does NOT use
// @lovable.dev/vite-tanstack-config / tanstackStart() — this is a plain
// client-only React build (see src/entry-static.tsx for why).
import { defineConfig } from "vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  // tanstackRouter() only regenerates routeTree.gen.ts and splits each route
  // into its own chunk at build time — it's a plain build-time tool with no
  // SSR/hydration runtime, unlike tanstackStart(), so it can't reintroduce
  // the hydration bug this config exists to avoid.
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    tsconfigPaths(),
  ],
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    rollupOptions: {
      input: "index.static.html",
    },
  },
});
