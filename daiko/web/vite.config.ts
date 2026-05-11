import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  base: "/app/",
  build: {
    outDir: path.resolve(__dirname, "../public/app"),
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    proxy: {
      "/api": { target: "http://127.0.0.1:3001", changeOrigin: true },
    },
  },
});
