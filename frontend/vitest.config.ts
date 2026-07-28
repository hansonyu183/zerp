import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,vue}'],
      exclude: ['src/env.d.ts', 'src/main.ts'],
      thresholds: {
        lines: 43.7,
        statements: 41,
        branches: 30,
        functions: 28,
        'src/api/client.ts': {
          lines: 75,
          statements: 73,
          branches: 68,
          functions: 75,
        },
        'src/pages/bob/shared/vm.ts': {
          lines: 67,
          statements: 63,
          branches: 54,
          functions: 62,
        },
        'src/pages/bob/shared/history.ts': {
          lines: 100,
          statements: 95,
          branches: 78,
          functions: 100,
        },
        'src/pages/led/opening/vm.ts': {
          lines: 68,
          statements: 60,
          branches: 50,
          functions: 55,
        },
        'src/pages/vou/shared/vm.ts': {
          lines: 55.9,
          statements: 51,
          branches: 53,
          functions: 58,
        },
        'src/pages/vou/shared/artifacts.ts': {
          lines: 100,
          statements: 100,
          branches: 82,
          functions: 100,
        },
      },
    },
  },
})
