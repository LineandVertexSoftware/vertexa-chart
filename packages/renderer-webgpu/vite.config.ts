import { defineConfig } from 'vite';

export default defineConfig({
  assetsInclude: ['**/*.wgsl'],
  build: {
    lib: {
      entry: './src/index.ts',
      formats: ['es'],
      fileName: 'index'
    },
    rollupOptions: {
      external: [], // Add external deps here
    }
  }
});
