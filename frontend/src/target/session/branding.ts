import { ref } from 'vue'
import { defineStore } from 'pinia'

import { getTargetBranding } from '../api.ts'

export const useTargetBranding = defineStore('target-branding', () => {
  const enterpriseName = ref('')
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref<string | null>(null)
  let sequence = 0

  async function load(force = false): Promise<void> {
    if (loaded.value && !force) return
    const request = ++sequence
    loading.value = true
    error.value = null
    try {
      const data = await getTargetBranding()
      if (request !== sequence) return
      enterpriseName.value = data.enterpriseName
      loaded.value = true
    } catch (cause) {
      if (request !== sequence) return
      error.value = `企业名称加载失败：${cause instanceof Error ? cause.message : '请求失败。'}`
    } finally {
      if (request === sequence) loading.value = false
    }
  }

  return { enterpriseName, loading, loaded, error, load }
})
