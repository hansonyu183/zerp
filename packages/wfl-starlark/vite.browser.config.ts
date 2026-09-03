import { resolve } from 'node:path'

import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: resolve(import.meta.dirname, 'src/browser-entry.ts'),
      formats: ['iife'],
      name: 'ZerpWflStarlarkFacade',
      fileName: () => 'facade.js',
    },
    minify: false,
    outDir: resolve(import.meta.dirname, 'generated'),
  },
})
