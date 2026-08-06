// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Static-hosting build (Bluehost, or any plain file host with no Node.js):
// `BUILD_TARGET=static bun run build` produces a fully static `dist/client`
// (no server needed at runtime — see .github/workflows/deploy-bluehost.yml).
// Leaving BUILD_TARGET unset keeps the normal Lovable/Cloudflare SSR build.
const isStaticBuild = process.env.BUILD_TARGET === "static";

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// @cloudflare/vite-plugin builds from this — wrangler.jsonc main alone is insufficient.
export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
    ...(isStaticBuild ? { spa: { enabled: true } } : {}),
  },
  ...(isStaticBuild ? { nitro: false as const } : {}),
  ...(isStaticBuild
    ? { vite: { preview: { host: "127.0.0.1" } } }
    : {}),
});
