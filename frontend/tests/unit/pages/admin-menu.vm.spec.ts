import { describe, expect, it, vi } from 'vitest'
import type { MenuData } from '@/api/menu'
import {
  activateMenu,
  getMenu,
  resetBusinessMenu,
  saveBusinessMenu,
} from '@/api/menu'
import { createMenuViewModel } from '@/pages/app/menu/vm'

function sampleMenu(): MenuData {
  const items = [
    {
      id: 'workbench',
      parentId: null,
      type: 'ROUTE' as const,
      level: 1,
      order: 10,
      displayName: '工作台',
      icon: 'mdi-view-dashboard-outline',
      enabled: true,
      routeKey: 'home/dashboard',
      routePath: '/home/dashboard',
      permissionCode: '/app/workbench/query',
    },
    {
      id: 'system',
      parentId: null,
      type: 'GROUP' as const,
      level: 1,
      order: 20,
      displayName: '系统管理',
      icon: 'mdi-cog-outline',
      enabled: true,
      routeKey: null,
      routePath: null,
      permissionCode: null,
    },
    {
      id: 'menu',
      parentId: 'system',
      type: 'ROUTE' as const,
      level: 2,
      order: 10,
      displayName: '菜单管理',
      icon: 'mdi-menu',
      enabled: true,
      routeKey: 'app/menu',
      routePath: '/app/menu',
      permissionCode: '/app/menu/save-business',
    },
  ]
  return {
    mode: 'DEFAULT',
    revision: 2,
    defaultMenu: { items },
    businessMenu: { items },
    navigation: { items },
    availableRoutes: [
      {
        routeKey: 'home/dashboard',
        routePath: '/home/dashboard',
        displayName: '工作台',
        permissionCode: '/app/workbench/query',
      },
      {
        routeKey: 'app/menu',
        routePath: '/app/menu',
        displayName: '菜单管理',
        permissionCode: '/app/menu/save-business',
      },
      {
        routeKey: 'app/user',
        routePath: '/app/user',
        displayName: '用户管理',
        permissionCode: '/app/user/query',
      },
    ],
  }
}

function setup(can: (permission: string) => boolean = () => true) {
  const data = sampleMenu()
  const load = vi.fn(async () => ({ data }))
  const save = vi.fn(async () => ({ data: { ...data, revision: 3 } }))
  const activate = vi.fn(async () => ({
    data: { ...data, mode: 'BUSINESS' as const, revision: 3 },
  }))
  const reset = vi.fn(async () => ({ data: { ...data, revision: 3 } }))
  const apply = vi.fn()
  const vm = createMenuViewModel({
    load: load as unknown as typeof getMenu,
    save: save as unknown as typeof saveBusinessMenu,
    activate: activate as unknown as typeof activateMenu,
    reset: reset as unknown as typeof resetBusinessMenu,
    apply,
    can,
  })
  return { vm, load, save, activate, reset, apply }
}

describe('menu management view model', () => {
  it('加载业务菜单并只列出尚未使用的可添加路由', async () => {
    const { vm } = setup()
    await vm.load()

    expect(vm.data?.revision).toBe(2)
    expect(vm.dirty).toBe(false)
    expect(vm.availableRoutes.map((item) => item.routeKey)).toEqual([
      'app/user',
    ])
  })

  it('整树保存后立即刷新当前导航', async () => {
    const { vm, save, apply } = setup()
    await vm.load()
    apply.mockClear()
    vm.addGroup()
    const target = vm.groups.at(-1)!
    vm.newRouteByGroup[target.id] = 'app/user'
    vm.addRoute(target.id)

    expect(vm.children(target.id)).toHaveLength(1)
    expect(vm.availableRoutes).toHaveLength(0)
    await vm.saveTemplate()

    expect(save).toHaveBeenCalledWith(expect.objectContaining({ revision: 2 }))
    expect(apply).toHaveBeenCalledOnce()
    expect(vm.dirty).toBe(false)
    expect(vm.successMessage).toBe('业务菜单已保存并生效。')
  })

  it('切换模式需要二次确认并只提交模式与共享版本', async () => {
    const { vm, activate, apply } = setup()
    await vm.load()
    apply.mockClear()
    vm.selectedMode = 'BUSINESS'

    vm.requestActivation()
    expect(vm.activationConfirmationOpen).toBe(true)
    await vm.confirmActivation()

    expect(activate).toHaveBeenCalledWith({ mode: 'BUSINESS', revision: 2 })
    expect(apply).toHaveBeenCalledOnce()
  })

  it('恢复业务模板并立即刷新当前导航', async () => {
    const { vm, reset, apply } = setup()
    await vm.load()
    apply.mockClear()

    vm.requestReset()
    expect(vm.resetConfirmationOpen).toBe(true)
    await vm.confirmReset()

    expect(reset).toHaveBeenCalledWith({ revision: 2 })
    expect(apply).toHaveBeenCalledOnce()
    expect(vm.successMessage).toBe('业务菜单已恢复并生效。')
  })

  it('脏菜单切换模式前要求确认放弃', async () => {
    const { vm, activate } = setup()
    await vm.load()
    vm.addGroup()
    vm.selectedMode = 'BUSINESS'
    vm.requestActivation()

    expect(activate).not.toHaveBeenCalled()
    expect(vm.discardConfirmationOpen).toBe(true)
  })

  it('阻止停用最后一个菜单管理入口', async () => {
    const { vm, save } = setup()
    await vm.load()
    const menu = vm.editableItems.find((item) => item.routeKey === 'app/menu')!
    menu.enabled = false

    await vm.saveTemplate()

    expect(save).not.toHaveBeenCalled()
    expect(vm.errorMessage).toBe('必须保留已启用的菜单管理入口。')
  })

  it('没有保存权限时编辑入口不产生本地修改', async () => {
    const { vm } = setup(
      (permission) => permission !== '/app/menu/save-business',
    )
    await vm.load()
    const before = JSON.stringify(vm.editableItems)
    const group = vm.groups[0]!

    vm.addGroup()
    vm.removeGroup(group.id)
    vm.newRouteByGroup[group.id] = 'app/user'
    vm.addRoute(group.id)

    expect(JSON.stringify(vm.editableItems)).toBe(before)
    expect(vm.dirty).toBe(false)
  })
})
