import { describe, expect, it, vi } from 'vitest'
import type { MenuData } from '@/api/menu'
import {
  activateMenu,
  getMenu,
  resetBusinessMenu,
  saveBusinessMenu,
} from '@/api/menu'
import { createMenuViewModel } from '@/pages/admin/menu/vm'

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
      order: 10,
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
      routeKey: 'admin/menu',
      routePath: '/admin/menu',
      permissionCode: '/app/menu/save-business-template',
    },
  ]
  const tree = { revision: 3, items }
  return {
    mode: 'DEFAULT',
    modeRevision: 2,
    catalogRevision: 'catalog-revision-1',
    defaultMenu: tree,
    businessTemplate: tree,
    navigation: tree,
    availableRoutes: [
      {
        routeKey: 'home/dashboard',
        routePath: '/home/dashboard',
        displayName: '工作台',
        permissionCode: '/app/workbench/query',
      },
      {
        routeKey: 'admin/menu',
        routePath: '/admin/menu',
        displayName: '菜单管理',
        permissionCode: '/app/menu/save-business-template',
      },
      {
        routeKey: 'admin/user',
        routePath: '/admin/user',
        displayName: '用户管理',
        permissionCode: '/app/user/query',
      },
    ],
  }
}

function setup() {
  const data = sampleMenu()
  const load = vi.fn(async () => ({ data }))
  const save = vi.fn(async () => ({
    data: {
      ...data,
      businessTemplate: { ...data.businessTemplate, revision: 4 },
    },
  }))
  const activate = vi.fn(async () => ({
    data: { ...data, mode: 'BUSINESS_TEMPLATE' as const, modeRevision: 3 },
  }))
  const reset = vi.fn(async () => ({
    data: {
      ...data,
      businessTemplate: { ...data.businessTemplate, revision: 4 },
    },
  }))
  const apply = vi.fn()
  const vm = createMenuViewModel({
    load: load as unknown as typeof getMenu,
    save: save as unknown as typeof saveBusinessMenu,
    activate: activate as unknown as typeof activateMenu,
    reset: reset as unknown as typeof resetBusinessMenu,
    apply,
    can: () => true,
  })
  return { vm, load, save, activate, reset, apply }
}

describe('menu management view model', () => {
  it('不暴露工作台作为可添加路由', async () => {
    const { vm } = setup()
    await vm.load()

    expect(
      vm.availableRoutes.some((item) => item.routeKey === 'home/dashboard'),
    ).toBe(false)
  })

  it('禁止通过新增路由直接添加工作台', async () => {
    const { vm } = setup()
    await vm.load()

    vm.newRouteByGroup.system = 'home/dashboard'
    vm.addRoute('system')

    expect(
      vm.children('system').some((item) => item.routeKey === 'home/dashboard'),
    ).toBe(false)
  })

  it('加载模板并允许重复路由、跨组移动和整树保存', async () => {
    const { vm, save, apply } = setup()
    await vm.load()
    vm.addGroup()
    const target = vm.groups.at(-1)
    expect(target).toBeDefined()
    vm.newRouteByGroup[target!.id] = 'admin/user'
    vm.addRoute(target!.id)
    vm.newRouteByGroup[target!.id] = 'admin/user'
    vm.addRoute(target!.id)

    const duplicates = vm.children(target!.id)
    expect(duplicates).toHaveLength(2)
    vm.move(duplicates[1]!.id, -1)
    vm.startDrag(duplicates[0]!.id)
    vm.dropOnGroup('system')
    expect(
      vm.children('system').some((item) => item.routeKey === 'admin/user'),
    ).toBe(true)

    vm.startDrag(target!.id)
    vm.dropOnGroupOrder('system')
    const removableRoute = vm.children(target!.id)[0]
    vm.removeRoute(removableRoute!.id)
    vm.addGroup()
    const removableGroup = vm.groups.at(-1)!
    vm.removeGroup(removableGroup.id)

    await vm.saveTemplate()
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        revision: 3,
        catalogRevision: 'catalog-revision-1',
      }),
    )
    expect(
      save.mock.calls[0]?.[0].items.some(
        (item) => item.routeKey === 'admin/user',
      ),
    ).toBe(true)
    expect(apply).toHaveBeenCalled()
  })

  it('应用模式后立即更新导航数据，并以二次确认恢复模板', async () => {
    const { vm, activate, reset } = setup()
    await vm.load()
    vm.selectedMode = 'BUSINESS_TEMPLATE'
    await vm.applyMode()
    expect(activate).toHaveBeenCalledWith({
      mode: 'BUSINESS_TEMPLATE',
      revision: 2,
    })
    expect(vm.data?.mode).toBe('BUSINESS_TEMPLATE')

    vm.requestReset()
    expect(vm.resetConfirmationOpen).toBe(true)
    await vm.confirmReset()
    expect(reset).toHaveBeenCalledWith({ revision: 3 })
    expect(vm.resetConfirmationOpen).toBe(false)
  })

  it('阻止删除或停用最后一个菜单管理入口', async () => {
    const { vm, save } = setup()
    await vm.load()
    const menu = vm.editableItems.find((item) => item.routeKey === 'admin/menu')
    menu!.enabled = false

    await vm.saveTemplate()

    expect(save).not.toHaveBeenCalled()
    expect(vm.errorMessage).toBe('必须保留已启用的菜单管理入口。')
  })

  it('阻止其他菜单使用工作台名称', async () => {
    const { vm, save } = setup()
    await vm.load()
    const menu = vm.editableItems.find((item) => item.routeKey === 'admin/menu')
    menu!.displayName = ' 工作台 '

    await vm.saveTemplate()

    expect(save).not.toHaveBeenCalled()
    expect(vm.errorMessage).toBe('工作台名称只能用于唯一的一级入口。')
  })
})
