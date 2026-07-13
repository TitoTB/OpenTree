import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    proxy: {
      "/ine-api": {
        target: "https://www.ine.es",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/ine-api/, "")
      },
      "/forebears-api": {
        target: "https://forebears.io",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/forebears-api/, "")
      },
      "/geneanet-api": {
        target: "https://es.geneanet.org",
        changeOrigin: true,
        secure: true,
        headers: {
          "User-Agent": "Mozilla/5.0 OpenTree/0.1 local genealogy app"
        },
        rewrite: (path) => path.replace(/^\/geneanet-api/, "")
      },
      "/behindthename-api": {
        target: "https://www.behindthename.com",
        changeOrigin: true,
        secure: true,
        headers: {
          "User-Agent": "Mozilla/5.0 OpenTree/0.1 local genealogy app"
        },
        rewrite: (path) => path.replace(/^\/behindthename-api/, "")
      },
      "/translate-api": {
        target: "https://api.mymemory.translated.net",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/translate-api/, "")
      },
      "/medlineplus-api": {
        target: "https://wsearch.nlm.nih.gov",
        changeOrigin: true,
        secure: true,
        headers: {
          "User-Agent": "OpenTree/0.1 local genealogy app"
        },
        rewrite: (path) => path.replace(/^\/medlineplus-api/, "")
      },
      "/mayo-clinic-api": {
        target: "https://www.mayoclinic.org",
        changeOrigin: true,
        secure: true,
        headers: {
          "User-Agent": "Mozilla/5.0 OpenTree/0.1 local genealogy app"
        },
        rewrite: (path) => path.replace(/^\/mayo-clinic-api/, "")
      },
      "/mediamass-api": {
        target: "https://es.mediamass.net",
        changeOrigin: true,
        secure: true,
        headers: {
          "User-Agent": "Mozilla/5.0 OpenTree/0.1 local genealogy app"
        },
        rewrite: (path) => path.replace(/^\/mediamass-api/, "")
      }
    }
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "es2020",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: Boolean(process.env.TAURI_DEBUG)
  }
});
