/// <reference types="vite/client" />

declare module '*.vue' {
  import type { Component } from 'vue'

  const component: Component
  export default component
}

interface ImportMetaEnv {
  readonly VITE_TARGET_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
