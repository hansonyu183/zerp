import { apiClient } from '@/api/client'

export type MenuMode = 'DEFAULT' | 'BUSINESS_TEMPLATE'
export type MenuItemType = 'GROUP' | 'ROUTE'

export interface MenuItem {
  id: string
  parentId: string | null
  type: MenuItemType
  level: number
  order: number
  displayName: string
  icon: string | null
  enabled: boolean
  routeKey: string | null
  routePath: string | null
  permissionCode: string | null
}

export interface MenuTree {
  revision: number
  items: MenuItem[]
}

export interface MenuRouteOption {
  routeKey: string
  routePath: string
  displayName: string
  permissionCode: string | null
}

export interface MenuData {
  mode: MenuMode
  modeRevision: number
  catalogRevision: string
  defaultMenu: MenuTree
  businessTemplate: MenuTree
  navigation: MenuTree
  availableRoutes: MenuRouteOption[]
}

export interface SaveMenuItem {
  id: string
  parentId: string | null
  type: MenuItemType
  order: number
  displayName: string
  icon: string | null
  enabled: boolean
  routeKey: string | null
}

export function getMenu() {
  return apiClient.post<MenuData>('app/menu/get', {})
}

export function saveBusinessMenu(input: {
  revision: number
  catalogRevision: string
  items: SaveMenuItem[]
}) {
  return apiClient.post<MenuData, typeof input>(
    'app/menu/save-business-template',
    input,
  )
}

export function activateMenu(input: { mode: MenuMode; revision: number }) {
  return apiClient.post<MenuData, typeof input>('app/menu/activate', input)
}

export function resetBusinessMenu(input: { revision: number }) {
  return apiClient.post<MenuData, typeof input>(
    'app/menu/reset-business-template',
    input,
  )
}
