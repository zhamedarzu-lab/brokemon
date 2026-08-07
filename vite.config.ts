import { defineConfig } from "vite";

/**
 * Replit serves the app through an HTTPS proxy on *.replit.dev, so the browser
 * is never talking to this server directly. Everything below exists only
 * because of that proxy, and is wrong to apply anywhere else.
 */
const onReplit = Boolean(process.env.REPL_ID);

const throughProxy = {
  host: true,
  // Must match `waitForPort` and `[[ports]].localPort` in .replit.
  port: 3000,
  // The proxy's Host header never matches localhost, and Vite's DNS-rebinding
  // guard would otherwise answer "Blocked request. This host is not allowed."
  allowedHosts: true,
  // The page is HTTPS on 443, so the hot-reload socket has to be too. Setting
  // clientPort unconditionally aims it at :443 even on a plain-http local
  // server, where it cannot connect and throws "WebSocket closed without
  // opened." on every single page load.
  ...(onReplit ? { hmr: { protocol: "wss" as const, clientPort: 443 } } : {}),
};

export default defineConfig({
  base: "/",
  build: { target: "es2022", outDir: "dist" },
  server: throughProxy,
  preview: throughProxy,
});
