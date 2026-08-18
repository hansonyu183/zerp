import { describe, expect, it, vi } from 'vitest'
import type { MenuData } from '@/api/menu'
import {
  activateMenu,
  getMenu,
  publishBusinessMenu,
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
      permissionCode: '/app/menu/save-business-template',
    },
  ]
  return {
    mode: 'DEFAULT',
    modeRevision: 2,
    catalogRevision: 'catalog-revision-1',
    defaultMenu: { revision: 1, items },
    draft: { revision: 3, items },
    published: { revision: 5, items },
    navigation: { revision: 1, items },
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
        permissionCode: '/app/menu/save-business-template',
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
  const save = vi.fn(async () => ({
    data: { ...data, draft: { ...data.draft, revision: 4 } },
  }))
  const publish = vi.fn(async () => ({
    data: { ...data, published: { ...data.draft, revision: 6 } },
  }))
  const activate = vi.fn(async () => ({
    data: { ...data, mode: 'BUSINESS_TEMPLATE' as const, modeRevision: 3 },
  }))
  const reset = vi.fn(async () => ({
    data: { ...data, draft: { ...data.draft, revision: 4 } },
  }))
  const apply = vi.fn()
  const vm = createMenuViewModel({
    load: load as unknown as typeof getMenu,
    save: save as unknown as typeof saveBusinessMenu,
    publish: publish as unknown as typeof publishBusinessMenu,
    activate: activate as unknown as typeof activateMenu,
    reset: reset as unknown as typeof resetBusinessMenu,
    apply,
    can,
  })
  return { vm, load, save, publish, activate, reset, apply }
}

describe('menu management view model', () => {
  it('加载草稿和已发布快照且不暴露工作台作为可添加路由', async () => {
    const { vm } = setup()
    await vm.load()

    expect(vm.data?.draft.revision).toBe(3)
    expect(vm.data?.published.revision).toBe(5)
    expect(vm.dirty).toBe(false)
    expect(
      vm.availableRoutes.some((item) => item.routeKey === 'home/dashboard'),
    ).toBe(false)
  })

  it('允许重复路由和整树保存草稿，但保存不刷新当前导航', async () => {
    const { vm, save, apply } = setup()
    await vm.load()
    apply.mockClear()
    vm.addGroup()
    const target = vm.groups.at(-1)!
    vm.newRouteByGroup[target.id] = 'app/user'
    vm.addRoute(target.id)
    vm.newRouteByGroup[target.id] = 'app/user'
    vm.addRoute(target.id)

    expect(vm.children(target.id)).toHaveLength(2)
    expect(vm.dirty).toBe(true)
    await vm.saveTemplate()

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        revision: 3,
        catalogRevision: 'catalog-revision-1',
      }),
    )
    expect(apply).not.toHaveBeenCalled()
    expect(vm.dirty).toBe(false)
    expect(vm.successMessage).toBe('草稿已保存，尚未发布。')
  })

  it('发布使用准确草稿证据、不切换模式并刷新当前管理员导航', async () => {
    const { vm, publish, apply } = setup()
    await vm.load()
    apply.mockClear()

    vm.requestPublish()
    expect(vm.publishConfirmationOpen).toBe(true)
    await vm.confirmPublish()

    expect(publish).toHaveBeenCalledWith({
      revision: 3,
      catalogRevision: 'catalog-revision-1',
    })
    expect(vm.data?.mode).toBe('DEFAULT')
    expect(apply).toHaveBeenCalledOnce()
  })

  it('切换模式需要二次确认并只提交模式与目录证据', async () => {
    const { vm, activate, apply } = setup()
    await vm.load()
    apply.mockClear()
    vm.selectedMode = 'BUSINESS_TEMPLATE'

    vm.requestActivation()
    expect(vm.activationConfirmationOpen).toBe(true)
    await vm.confirmActivation()

    expect(activate).toHaveBeenCalledWith({
      mode: 'BUSINESS_TEMPLATE',
      revision: 2,
      catalogRevision: 'catalog-revision-1',
    })
    expect(apply).toHaveBeenCalledOnce()
  })

  it('恢复只提交草稿和目录证据且不会刷新当前导航', async () => {
    const { vm, reset, apply } = setup()
    await vm.load()
    apply.mockClear()

    vm.requestReset()
    expect(vm.resetConfirmationOpen).toBe(true)
    await vm.confirmReset()

    expect(reset).toHaveBeenCalledWith({
      revision: 3,
      catalogRevision: 'catalog-revision-1',
    })
    expect(apply).not.toHaveBeenCalled()
    expect(vm.successMessage).toBe('草稿已恢复，尚未发布。')
  })

  it('脏草稿不能直接发布或切换模式', async () => {
    const { vm, publish, activate } = setup()
    await vm.load()
    vm.addGroup()

    vm.requestPublish()
    vm.selectedMode = 'BUSINESS_TEMPLATE'
    vm.requestActivation()

    expect(publish).not.toHaveBeenCalled()
    expect(activate).not.toHaveBeenCalled()
    expect(vm.discardConfirmationOpen).toBe(true)
  })

  it('阻止删除或停用最后一个菜单管理入口', async () => {
    const { vm, save } = setup()
    await vm.load()
    const menu = vm.editableItems.find((item) => item.routeKey === 'app/menu')!
    menu.enabled = false

    await vm.saveTemplate()

    expect(save).not.toHaveBeenCalled()
    expect(vm.errorMessage).toBe('必须保留已启用的菜单管理入口。')
  })

  it('没有保存权限时所有草稿编辑入口均不产生本地修改', async () => {
    const { vm } = setup(
      (permission) => permission !== '/app/menu/save-business-template',
    )
    await vm.load()
    const before = JSON.stringify(vm.editableItems)
    const group = vm.groups[0]!
    const route = vm.children(group.id)[0]!

    vm.addGroup()
    vm.removeGroup(group.id)
    vm.newRouteByGroup[group.id] = 'app/user'
    vm.addRoute(group.id)
    vm.removeRoute(route.id)
    vm.move(route.id, 1)
    vm.startDrag(route.id)
    vm.dropOnGroup(group.id)
    vm.dropOnGroupOrder(group.id)

    expect(JSON.stringify(vm.editableItems)).toBe(before)
    expect(vm.draggedID).toBeNull()
    expect(vm.dirty).toBe(false)
  })
})
