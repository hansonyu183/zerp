import { computed, ref } from 'vue'

export interface DynamicWflRoute {
  routePath: string
  permissionCode: string | null
}

export function createDynamicWflViewModel(
  code: string,
  routes: readonly DynamicWflRoute[],
  permissions: readonly string[],
) {
  const currentCode = ref(code)
  const validCode = computed(() =>
    /^[a-z][a-z0-9-]{1,62}[a-z0-9]$/.test(currentCode.value),
  )
  const routePath = computed(() => `/wfl/${currentCode.value}`)
  const available = computed(
    () =>
      validCode.value &&
      currentCode.value !== 'process-definition' &&
      currentCode.value !== 'process-instance' &&
      routes.some(
        (route) =>
          route.routePath === routePath.value &&
          route.permissionCode === '/wfl/process-instance/query',
      ) &&
      permissions.includes('/wfl/process-instance/query'),
  )
  function setCode(nextCode: string): void {
    currentCode.value = nextCode
  }
  return { code: currentCode, routePath, available, setCode }
}
