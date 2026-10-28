import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import vuetify from 'vite-plugin-vuetify';
import { fileURLToPath, URL } from 'node:url';
import { compressRobotMeshes } from './scripts/compressRobotMeshes';

// On GitHub Actions, serve under /<repo>/ for GitHub Pages project sites.
const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1];
const base = process.env.GITHUB_ACTIONS && repoName ? `/${repoName}/` : '/';

export default defineConfig({
  base,
  // autoImport: only the Vuetify components/directives the templates use (and
  // their CSS) are bundled, instead of the whole library. styles.configFile
  // compiles Vuetify's SASS with src/styles/vuetify-settings.scss.
  plugins: [
    vue(),
    vuetify({ autoImport: true, styles: { configFile: 'src/styles/vuetify-settings.scss' } }),
    compressRobotMeshes(),
  ],
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
          if (!id.includes('node_modules') || id.includes('mujoco-js')) return undefined;
          // Libraries that are only ever imported lazily keep chunks of their own:
          // folding them into `vendor` (which every page preloads) would undo the
          // dynamic import.
          if (id.includes('@mediapipe')) return 'vendor-mediapipe';
          if (id.includes('plotly.js')) return 'vendor-plotly';
          if (id.includes('fflate')) return 'vendor-fflate';
          // three.js loaders / exporters are only used by the lazily loaded
          // gallery mesh converters (src/lib/gallery/): keep them out of the
          // first-paint three.js chunk.
          if (/three\/examples\/jsm\/(loaders|exporters)\//.test(id)) return undefined;
          if (id.includes('three')) return 'vendor-three';
          if (id.includes('vuetify')) return 'vendor-vuetify';
          return 'vendor';
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
