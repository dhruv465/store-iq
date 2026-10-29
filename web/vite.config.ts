import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

/** The portal is served by the Store IQ server at /manager, so it is built with that base. In
 *  development the API is proxied from the same origin, which keeps the portal's own request
 *  header and the server's origin check working exactly as they do in production. */
export default defineConfig({
  base: "/manager/",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    proxy: {
      "/api": { target: "http://127.0.0.1:3000", changeOrigin: false },
    },
  },
});
