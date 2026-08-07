import { defineConfig } from "vite";

/**
 * Replit serves the dev server through a *.replit.dev proxy, so the Host
 * header never matches localhost. Vite's DNS-rebinding protection blocks that
 * by default with "Blocked request. This host is not allowed."
 *
 * The relaxations below are scoped to Replit rather than applied everywhere,
 * so a dev server on your own machine keeps its host checking.
 */
const onReplit = Boolean(process.env.REPL_ID || process.env.REPLIT_DEV_DOMAIN);

// Replit assigns the port; fall back to Vite's default off-platform.
const port = Number(process.env.PORT) || 5173;

export default defineConfig({
  base: "./",
  build: { target: "es2022", outDir: "dist" },
  server: {
    host: "0.0.0.0",
    port,
    ...(onReplit
      ? {
          allowedHosts: true as const,
          // The browser reaches the proxy over HTTPS on 443, not the app port,
          // so the hot-reload socket has to be told where to call back.
          hmr: { clientPort: 443 },
        }
      : {}),
  },
  preview: {
    host: "0.0.0.0",
    port,
    ...(onReplit ? { allowedHosts: true as const } : {}),
  },
});
