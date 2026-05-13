import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

// Replit dev-only plugins should never run during a production build.
// `runtimeErrorOverlay` injects helper code without sourcemaps, which is
// what surfaces as "Can't resolve original location of error" warnings on
// shadcn/ui components during `vercel build`. Gating it (and skipping
// sourcemaps in prod) keeps Vercel logs clean.
const isProdBuild = process.env.NODE_ENV === "production";

// On Replit, the workflow always provides PORT; on Vercel only `vite build`
// runs and PORT is irrelevant — fall back to a harmless dev port instead of
// throwing so the static build succeeds.
const rawPort = process.env.PORT ?? "5173";
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// On Replit, the workflow injects BASE_PATH (e.g. "/" for the emigration
// artifact). On Vercel the frontend lives at the site root — default to "/"
// so the build doesn't require an extra env var.
const basePath = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    ...(isProdBuild ? [] : [runtimeErrorOverlay()]),
    ...(!isProdBuild &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
