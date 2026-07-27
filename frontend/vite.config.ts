import { fileURLToPath, URL } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import vuetify, { transformAssetUrls } from 'vite-plugin-vuetify'

const mdiFontFacePattern = /@font-face\s*\{[\s\S]*?\}/

function mdiWoff2Only(): Plugin {
  return {
    name: 'mdi-woff2-only',
    enforce: 'pre',
    transform(code, id) {
      const normalizedId = id.replaceAll('\\', '/')
      if (!normalizedId.includes('/@mdi/font/css/materialdesignicons.css')) {
        return null
      }

      return {
        code: code.replace(
          mdiFontFacePattern,
          `@font-face {
  font-family: "Material Design Icons";
  src: url("../fonts/materialdesignicons-webfont.woff2?v=7.4.47") format("woff2");
  font-weight: normal;
  font-style: normal;
  font-display: block;
}`,
        ),
        map: null,
      }
    },
  }
}

function releaseMarker(): Plugin {
  const releaseSha = process.env.CF_PAGES_COMMIT_SHA ?? process.env.GITHUB_SHA

  if (releaseSha && !/^[0-9a-f]{40}$/.test(releaseSha)) {
    throw new Error('Release marker requires a full lowercase commit SHA')
  }

  return {
    name: 'release-marker',
    generateBundle() {
      if (!releaseSha) {
        return
      }
      this.emitFile({
        type: 'asset',
        fileName: '_zerp-release',
        source: `${releaseSha}\n`,
      })
    },
  }
}

export default defineConfig({
  plugins: [
    mdiWoff2Only(),
    releaseMarker(),
    vue({
      template: { transformAssetUrls },
    }),
    vuetify({ autoImport: true }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/files': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
})
