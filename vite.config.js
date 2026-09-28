import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig(({ mode }) => {
  const offline = mode === "offline";
  return {
  base: offline ? "./" : "/",
  assetsInclude: ["**/*.docx", "**/*.pdf"],
  resolve: offline
    ? { alias: { "virtual:pwa-register": "/src/engine/no-pwa.js" } }
    : {},
  define: { __OFFLINE__: JSON.stringify(offline) },
  build: offline
    ? { outDir: "dist-offline", assetsInlineLimit: 100_000_000, cssCodeSplit: false, reportCompressedSize: false }
    : { outDir: "dist" },
  plugins: [
    react(),
    ...(offline ? [viteSingleFile()] : []),
    ...(offline ? [] : [VitePWA({
      registerType: "prompt",
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.js",
      injectRegister: null,
      includeAssets: ["icon-192.png", "icon-512.png"],
      manifest: {
        name: "Offshore Report",
        short_name: "Offshore Report",
        description: "Small tools for people who work offshore.",
        lang: "en",
        start_url: "./",
        scope: "./",
        display: "standalone",
        orientation: "any",
        background_color: "#0E2430",
        theme_color: "#0E2430",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        ],
      },
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,woff2,png,svg,webmanifest,docx}"],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    })]),
  ],
  };
});
