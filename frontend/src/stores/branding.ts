import { ref } from 'vue'
import { defineStore } from 'pinia'
import { apiClient } from '@/api/client'
import { getErrorMessage } from '@/api/types'

export const ENTERPRISE_NAME_PARAMETER_KEY = 'app.enterprise-name'

export const useBrandingStore = defineStore('branding', () => {
  const enterpriseName = ref('')
  const loading = ref(false)
  const loaded = ref(false)
  const errorMessage = ref<string | null>(null)
  let requestSequence = 0
  let inFlight: Promise<void> | null = null

  async function load(force = false): Promise<void> {
    if (loaded.value && !force) return
    if (inFlight && !force) return inFlight

    const sequence = ++requestSequence
    loading.value = true
    errorMessage.value = null
    const request = apiClient
      .postContract('app/branding/get', {})
      .then(({ data }) => {
        if (sequence !== requestSequence) return
        enterpriseName.value = data.enterpriseName
        loaded.value = true
      })
      .catch((error: unknown) => {
        if (sequence !== requestSequence) return
        errorMessage.value = `企业名称加载失败：${getErrorMessage(error)}`
      })
      .finally(() => {
        if (sequence === requestSequence) {
          loading.value = false
          inFlight = null
        }
      })
    inFlight = request
    return request
  }

  return { enterpriseName, loading, loaded, errorMessage, load }
})
