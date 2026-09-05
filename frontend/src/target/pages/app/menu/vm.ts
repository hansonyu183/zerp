import { ref } from 'vue'

import {
  activateTargetMenu,
  getTargetMenu,
  resetTargetBusinessMenu,
  saveTargetBusinessMenu,
} from '../../../api.ts'
import { useTargetSession } from '../../../session/vm.ts'

type MenuData = Awaited<ReturnType<typeof getTargetMenu>>
type MenuItem = MenuData['businessMenu']['items'][number]

export function useMenuManagementViewModel() {
  const session = useTargetSession()
  const menu = ref<MenuData | null>(null)
  const items = ref<MenuItem[]>([])
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)
  const csrf = () => {
    if (!session.csrfToken) throw new Error('请重新登录。')
    return session.csrfToken
  }

  function apply(current: MenuData): void {
    menu.value = current
    items.value = current.businessMenu.items.map((item) => ({ ...item }))
  }

  async function load(): Promise<void> {
    loading.value = true
    try {
      apply(await getTargetMenu(csrf()))
      error.value = null
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '菜单加载失败。'
    } finally {
      loading.value = false
    }
  }

  function addGroup(): void {
    items.value.push({
      id: crypto.randomUUID(),
      parentId: null,
      type: 'GROUP',
      level: 1,
      order: items.value.length,
      displayName: '新菜单组',
      icon: null,
      enabled: true,
      routeKey: null,
      routePath: null,
      permissionCode: null,
    })
  }

  function addRoute(routeKey: string, parentId: string | null = null): void {
    const route = menu.value?.availableRoutes.find(
      (candidate) => candidate.routeKey === routeKey,
    )
    if (!route || items.value.some((item) => item.routeKey === routeKey)) return
    items.value.push({
      id: crypto.randomUUID(),
      parentId,
      type: 'ROUTE',
      level: parentId ? 2 : 1,
      order: items.value.length,
      displayName: route.displayName,
      icon: null,
      enabled: true,
      routeKey: route.routeKey,
      routePath: route.routePath,
      permissionCode: route.permissionCode,
    })
  }

  function remove(id: string): void {
    const children = new Set(
      items.value.filter((item) => item.parentId === id).map((item) => item.id),
    )
    items.value = items.value.filter(
      (item) => item.id !== id && !children.has(item.id),
    )
  }

  async function readBack(): Promise<void> {
    apply(await getTargetMenu(csrf()))
  }

  async function save(): Promise<void> {
    if (!menu.value || saving.value) return
    saving.value = true
    try {
      await saveTargetBusinessMenu(csrf(), {
        revision: Number(menu.value.revision),
        items: items.value.map((item, order) => ({
          id: item.id,
          parentId: item.parentId,
          type: item.type,
          order,
          displayName: item.displayName.trim(),
          icon: item.icon,
          enabled: item.enabled,
          routeKey: item.routeKey,
        })),
      })
      await readBack()
    } catch (cause) {
      error.value =
        cause instanceof Error ? cause.message : '业务菜单保存失败。'
    } finally {
      saving.value = false
    }
  }

  async function activate(mode: 'DEFAULT' | 'BUSINESS'): Promise<void> {
    if (!menu.value || saving.value) return
    saving.value = true
    try {
      await activateTargetMenu(csrf(), {
        mode,
        revision: Number(menu.value.revision),
      })
      await readBack()
      await session.retryMenu()
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '菜单启用失败。'
    } finally {
      saving.value = false
    }
  }

  async function reset(): Promise<void> {
    if (!menu.value || saving.value) return
    saving.value = true
    try {
      await resetTargetBusinessMenu(csrf(), Number(menu.value.revision))
      await readBack()
    } catch (cause) {
      error.value =
        cause instanceof Error ? cause.message : '业务菜单重置失败。'
    } finally {
      saving.value = false
    }
  }

  return {
    menu,
    items,
    loading,
    saving,
    error,
    load,
    addGroup,
    addRoute,
    remove,
    save,
    activate,
    reset,
  }
}
