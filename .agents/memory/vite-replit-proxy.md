---
name: Vite + Replit proxy white screen fix
description: Why Vite dev server causes a blank white screen through Replit's proxy, and how to fix it.
---

## Rule
Always set `server.hmr.clientPort: 443` in `vite.config.ts` for any Vite dev server running behind Replit's proxy.

**Why:** Vite's HMR client script (`/@vite/client`) tries to open a WebSocket back to the dev server. It uses the same host as the page but the dev server's *local* port (e.g. 3000). Replit's proxy only forwards port 80/443 externally — port 3000 is never reachable from the browser. The stalled WebSocket blocks module loading and leaves the page white. Setting `clientPort: 443` tells the HMR client to connect on the external HTTPS port, which routes correctly through the proxy.

**How to apply:** Any time a Vite project is set up in Replit and users report a blank/white screen despite the server returning 200:

```ts
server: {
  host: true,
  port: 3000,          // or whatever port the server uses
  allowedHosts: true,
  hmr: {
    clientPort: 443,   // ← the fix
  },
},
```

Also confirmed: the `.replit` `[[ports]]` table must have exactly one entry mapping the server's local port to `externalPort = 80`. Extra stale mappings (pointing at ports where nothing listens) silently make the primary bare URL serve nothing.
