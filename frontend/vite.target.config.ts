import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig, type Plugin } from 'vite'

function releaseMarker(): Plugin {
  const releaseSha = process.env.CF_PAGES_COMMIT_SHA ?? process.env.GITHUB_SHA

  if (releaseSha && !/^[0-9a-f]{40}$/.test(releaseSha)) {
    throw new Error('Release marker requires a full lowercase commit SHA')
  }

  return {
    name: 'release-marker',
    generateBundle() {
      if (!releaseSha) return
      this.emitFile({
        type: 'asset',
        fileName: '_zerp-release',
        source: `${releaseSha}\n`,
      })
    },
  }
}

export default defineConfig({
  plugins: [releaseMarker(), vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist-target',
    emptyOutDir: true,
    rollupOptions: {
      input: fileURLToPath(new URL('./index.html', import.meta.url)),
    },
  },
})
