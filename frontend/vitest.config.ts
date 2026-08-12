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
        lines: 50,
        statements: 48,
        branches: 36,
        functions: 32,
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
        'src/components/feedback/vm.ts': {
          lines: 80,
          statements: 78,
          branches: 70,
          functions: 80,
        },
        'src/pages/vou/shared/vm.ts': {
          lines: 55.9,
          statements: 51,
          branches: 40,
          functions: 58,
        },
        'src/pages/vou/shared/action-availability.ts': {
          lines: 100,
          statements: 100,
          branches: 80,
          functions: 100,
        },
        'src/pages/vou/shared/return-source.ts': {
          lines: 85,
          statements: 85,
          branches: 40,
          functions: 100,
        },
        'src/composables/use-product-reference-search.ts': {
          lines: 85,
          statements: 85,
          branches: 60,
          functions: 100,
        },
        'src/pages/vou/shared/payload.ts': {
          lines: 90,
          statements: 90,
          branches: 80,
          functions: 100,
        },
        'src/pages/vou/shared/artifacts.ts': {
          lines: 100,
          statements: 100,
          branches: 82,
          functions: 100,
        },
        'src/pages/wfl/process-definition/vm.ts': {
          lines: 44,
          statements: 42,
          branches: 30,
          functions: 45,
        },
      },
    },
  },
})
