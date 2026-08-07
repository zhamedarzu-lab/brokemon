---
name: Vite + Replit proxy white screen fix
description: Why Vite dev server causes a blank white screen through Replit's proxy, and the correct conditional fix.
---

## Rule
Gate `hmr.clientPort` on `REPL_ID` — do not set it unconditionally.

**Why:** Vite's HMR client opens a WebSocket back to the dev server. Through Replit's HTTPS proxy the browser can only reach the server on port 443, not the local dev port. But setting `clientPort: 443` unconditionally breaks non-Replit loads (local dev, CI) by aiming the socket at `:443` on a plain-HTTP server, which throws "WebSocket closed without opened" on every page load.

**Correct fix** (gate on `REPL_ID`):

```ts
const onReplit = Boolean(process.env.REPL_ID);

const throughProxy = {
  host: true,
  port: 3000,
  allowedHosts: true,
  ...(onReplit ? { hmr: { protocol: "wss" as const, clientPort: 443 } } : {}),
};

export default defineConfig({
  server: throughProxy,
  preview: throughProxy,   // covers production preview builds too
});
```

**Also confirmed:** the `.replit` `[[ports]]` table must have exactly one entry mapping the server's local port to `externalPort = 80`. Stale extra mappings (pointing at ports where nothing listens) silently make the primary bare URL serve nothing.

**Note:** An unconditional `hmr: { clientPort: 443 }` also appears to fix the white screen on Replit, but carries a hidden cost on every other environment.
