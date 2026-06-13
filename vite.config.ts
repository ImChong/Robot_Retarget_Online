import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

// On GitHub Actions, serve under /<repo>/ for GitHub Pages project sites.
const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1];
const base = process.env.GITHUB_ACTIONS && repoName ? `/${repoName}/` : '/';

export default defineConfig({
  base,
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    exclude: ['mujoco-js'],
  },
  build: {
    chunkSizeWarningLimit: 12000,
    rollupOptions: {
      output: {
        // NOTE: do not force mujoco-js into a manual chunk — it must stay a
        // purely dynamic chunk so the 11 MB wasm bundle is not modulepreloaded
        // on first paint.
        manualChunks(id) {
          if (id.includes('node_modules') && !id.includes('mujoco-js')) {
            if (id.includes('three')) return 'vendor-three';
            if (id.includes('vuetify')) return 'vendor-vuetify';
            return 'vendor';
          }
        },
      },
    },
  },
  server: {
    port: 3000,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 120000,
    hookTimeout: 60000,
  },
} as Parameters<typeof defineConfig>[0]);
