import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

// Frontend regression tests (Vitest + React Testing Library + MSW). Kept
// separate from vite.config.ts so the build pipeline (meta-variant HTML,
// manual chunks, terser) is untouched.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // The Supabase client reads these at import time. The host is fake: every
    // request to it is answered by the MSW backend in src/test/msw.
    env: {
      VITE_SUPABASE_URL: 'https://pxtest.supabase.local',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    },
    css: false,
    // The response-stream scenarios exercise the real retry plan (2.5 s and
    // 6 s backoffs plus the query-level retry), so they take ~20 s.
    testTimeout: 90_000,
    hookTimeout: 30_000,
    // One dashboard tree at a time: the Supabase client is a module singleton.
    fileParallelism: false,
  },
});
