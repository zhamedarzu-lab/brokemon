import { defineConfig } from "vite";

export default defineConfig({
  base: "/",
  build: { target: "es2022", outDir: "dist" },
  server: {
    host: true,
    port: 3000,
    allowedHosts: true,
    hmr: {
      clientPort: 443,
    },
  },
});
