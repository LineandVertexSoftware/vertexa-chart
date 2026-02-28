import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      "@vertexa-chart/vertexa-chart-core": resolve(__dirname, "../../packages/vertexa-chart-core/src/index.ts"),
      "@vertexa-chart/overlay-d3": resolve(__dirname, "../../packages/overlay-d3/src/index.ts"),
      "@vertexa-chart/renderer-webgpu": resolve(__dirname, "../../packages/renderer-webgpu/src/index.ts")
    }
  },
  server: {
    port: 5173
  }
});
