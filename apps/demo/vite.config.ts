import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      "@lineandvertexsoftware/vertexa-chart": resolve(__dirname, "../../packages/vertexa-chart/src/index.ts"),
      "@lineandvertexsoftware/overlay-d3": resolve(__dirname, "../../packages/overlay-d3/src/index.ts"),
      "@lineandvertexsoftware/renderer-webgpu": resolve(__dirname, "../../packages/renderer-webgpu/src/index.ts")
    }
  },
  server: {
    port: 5173
  }
});
