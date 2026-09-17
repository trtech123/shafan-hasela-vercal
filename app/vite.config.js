import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  logLevel: 'error', // Suppress warnings, only show errors
  resolve: {
    // The '@' -> 'src' alias was previously injected by @base44/vite-plugin.
    // Now that the plugin is removed, declare it explicitly.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [
    react(),
  ],
  test: {
    // Every test in this suite is deterministic and finishes in ~0.1-2.1s in
    // isolation. The 5s default was only ever exceeded under worker CPU
    // starvation across the 48-file jsdom suite, which made roughly 40% of
    // full runs fail on a different file each time. 20s removes those false
    // failures while still catching a genuinely hung test.
    testTimeout: 20000,
    // The Edge Function tests are plain vitest suites living outside app/, so
    // the default include silently skipped all 13 files / 156 tests. List both
    // roots explicitly so one `npm test` covers frontend and Edge Functions.
    include: ['src/**/*.{test,spec}.?(c|m)[jt]s?(x)', '../supabase/functions/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
  },
});