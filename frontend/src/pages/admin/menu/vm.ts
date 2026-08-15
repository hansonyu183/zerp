import {
  activateMenu,
  getMenu,
  resetBusinessMenu,
  saveBusinessMenu,
  type MenuData,
  type MenuItem,
  type MenuMode,
  type MenuRouteOption,
  type SaveMenuItem,
} from '@/api/menu'
import { getErrorMessage } from '@/api/types'

interface MenuDependencies {
  load: typeof getMenu
  save: typeof saveBusinessMenu
  activate: typeof activateMenu
  reset: typeof resetBusinessMenu
  apply: (data: MenuData) => void
  can: (permission: string) => boolean
}

let localID = 0
function nextItemID(prefix: string): string {
  localID += 1
  return `${prefix}-${Date.now()}-${localID}`
}

function cloneEditable(items: readonly MenuItem[]): SaveMenuItem[] {
  return items.map((item) => ({
    id: item.id,
    parentId: item.parentId,
    type: item.type,
    order: item.order,
    displayName: item.displayName,
    icon: item.icon,
    enabled: item.enabled,
    routeKey: item.routeKey,
  }))
}

export function createMenuViewModel(dependencies: MenuDependencies) {
  return {
    loading: false,
    saving: false,
    errorMessage: null as string | null,
    successMessage: null as string | null,
    data: null as MenuData | null,
    selectedMode: 'DEFAULT' as MenuMode,
    editableItems: [] as SaveMenuItem[],
    newRouteByGroup: {} as Record<string, string | null>,
    resetConfirmationOpen: false,
    draggedID: null as string | null,

    get canSave(): boolean {
      return dependencies.can('/app/menu/save-business-template')
    },
    get canActivate(): boolean {
      return dependencies.can('/app/menu/activate')
    },
    get canReset(): boolean {
      return dependencies.can('/app/menu/reset-business-template')
    },
    get groups(): SaveMenuItem[] {
      return this.editableItems
        .filter((item) => item.type === 'GROUP')
        .sort((left, right) => left.order - right.order)
    },
    get workbench(): SaveMenuItem | undefined {
      return this.editableItems.find(
        (item) =>
          item.type === 'ROUTE' &&
          item.parentId === null &&
          item.routeKey === 'home/dashboard',
      )
    },
    get availableRoutes(): MenuRouteOption[] {
      return (this.data?.availableRoutes ?? []).filter(
        (item) => item.routeKey !== 'home/dashboard',
      )
    },
    children(groupID: string): SaveMenuItem[] {
      return this.editableItems
        .filter((item) => item.type === 'ROUTE' && item.parentId === groupID)
        .sort((left, right) => left.order - right.order)
    },
    routeOption(routeKey: string | null): MenuRouteOption | undefined {
      return this.availableRoutes.find((item) => item.routeKey === routeKey)
    },
    async load(): Promise<void> {
      this.loading = true
      this.errorMessage = null
      try {
        const { data } = await dependencies.load()
        this.applyData(data)
      } catch (error) {
        this.errorMessage = getErrorMessage(error)
      } finally {
        this.loading = false
      }
    },
    applyData(data: MenuData): void {
      this.data = data
      this.selectedMode = data.mode
      this.editableItems = cloneEditable(data.businessTemplate.items)
      dependencies.apply(data)
    },
    addGroup(): void {
      const order = Math.max(0, ...this.groups.map((item) => item.order)) + 10
      this.editableItems.push({
        id: nextItemID('group'),
        parentId: null,
        type: 'GROUP',
        order,
        displayName: '新分组',
        icon: 'mdi-folder-outline',
        enabled: true,
        routeKey: null,
      })
    },
    removeGroup(groupID: string): void {
      this.editableItems = this.editableItems.filter(
        (item) => item.id !== groupID && item.parentId !== groupID,
      )
    },
    addRoute(groupID: string): void {
      const routeKey = this.newRouteByGroup[groupID]
      const option = this.routeOption(routeKey ?? null)
      if (!option) return
      const children = this.children(groupID)
      this.editableItems.push({
        id: nextItemID('route'),
        parentId: groupID,
        type: 'ROUTE',
        order: Math.max(0, ...children.map((item) => item.order)) + 10,
        displayName: option.displayName,
        icon: 'mdi-file-document-outline',
        enabled: true,
        routeKey: option.routeKey,
      })
      this.newRouteByGroup[groupID] = null
    },
    removeRoute(id: string): void {
      this.editableItems = this.editableItems.filter((item) => item.id !== id)
    },
    moveRoute(id: string, groupID: string): void {
      const item = this.editableItems.find((candidate) => candidate.id === id)
      if (!item || item.type !== 'ROUTE') return
      item.parentId = groupID
      item.order =
        Math.max(0, ...this.children(groupID).map((child) => child.order)) + 10
      this.normalizeOrders()
    },
    move(id: string, direction: -1 | 1): void {
      const item = this.editableItems.find((candidate) => candidate.id === id)
      if (!item) return
      const siblings =
        item.type === 'GROUP' ? this.groups : this.children(item.parentId ?? '')
      const index = siblings.findIndex((candidate) => candidate.id === id)
      const target = siblings[index + direction]
      if (!target) return
      const order = item.order
      item.order = target.order
      target.order = order
      this.normalizeOrders()
    },
    startDrag(id: string): void {
      this.draggedID = id
    },
    dropOnGroup(groupID: string): void {
      if (this.draggedID) this.moveRoute(this.draggedID, groupID)
      this.draggedID = null
    },
    dropOnGroupOrder(targetID: string): void {
      const source = this.editableItems.find(
        (item) => item.id === this.draggedID,
      )
      const target = this.editableItems.find((item) => item.id === targetID)
      if (source?.type === 'GROUP' && target?.type === 'GROUP') {
        const order = source.order
        source.order = target.order
        target.order = order
        this.normalizeOrders()
      }
      this.draggedID = null
    },
    normalizeOrders(): void {
      this.groups.forEach((group, index) => {
        group.order = (index + 1) * 10
        this.children(group.id).forEach((item, childIndex) => {
          item.order = (childIndex + 1) * 10
        })
      })
    },
    validationError(): string | null {
      if (this.groups.length === 0) return '业务归类模板至少需要一个分组。'
      if (this.editableItems.some((item) => !item.displayName.trim())) {
        return '分组和菜单名称不能为空。'
      }
      if (
        !this.workbench ||
        !this.workbench.enabled ||
        this.workbench.displayName.trim() !== '工作台'
      ) {
        return '必须保留唯一已启用的工作台一级入口。'
      }
      if (
        this.editableItems.some(
          (item) =>
            item.routeKey !== 'home/dashboard' &&
            item.displayName.trim() === '工作台',
        )
      ) {
        return '工作台名称只能用于唯一的一级入口。'
      }
      const menuEntry = this.editableItems.find(
        (item) => item.routeKey === 'admin/menu' && item.enabled,
      )
      const parent = this.editableItems.find(
        (item) => item.id === menuEntry?.parentId,
      )
      if (!menuEntry || !parent?.enabled)
        return '必须保留已启用的菜单管理入口。'
      return null
    },
    async saveTemplate(): Promise<void> {
      if (!this.canSave || !this.data) return
      const validation = this.validationError()
      if (validation) {
        this.errorMessage = validation
        return
      }
      this.saving = true
      this.errorMessage = null
      try {
        this.normalizeOrders()
        const { data } = await dependencies.save({
          revision: this.data.businessTemplate.revision,
          catalogRevision: this.data.catalogRevision,
          items: this.editableItems.map((item) => ({
            ...item,
            displayName: item.displayName.trim(),
            icon: item.icon?.trim() || null,
          })),
        })
        this.applyData(data)
        this.successMessage = '业务归类模板已保存。'
      } catch (error) {
        this.errorMessage = getErrorMessage(error)
      } finally {
        this.saving = false
      }
    },
    async applyMode(): Promise<void> {
      if (!this.canActivate || !this.data) return
      this.saving = true
      this.errorMessage = null
      try {
        const { data } = await dependencies.activate({
          mode: this.selectedMode,
          revision: this.data.modeRevision,
        })
        this.applyData(data)
        this.successMessage = '菜单方式已应用，主导航已刷新。'
      } catch (error) {
        this.errorMessage = getErrorMessage(error)
      } finally {
        this.saving = false
      }
    },
    requestReset(): void {
      if (this.canReset) this.resetConfirmationOpen = true
    },
    async confirmReset(): Promise<void> {
      if (!this.canReset || !this.data) return
      this.saving = true
      this.errorMessage = null
      try {
        const { data } = await dependencies.reset({
          revision: this.data.businessTemplate.revision,
        })
        this.applyData(data)
        this.resetConfirmationOpen = false
        this.successMessage = '业务归类模板已恢复为初始模板。'
      } catch (error) {
        this.errorMessage = getErrorMessage(error)
      } finally {
        this.saving = false
      }
    },
  }
}
