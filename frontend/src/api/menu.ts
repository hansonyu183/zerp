import { apiClient } from '@/api/client'
import type { components } from '@/api/generated/schema'

export type MenuMode = components['schemas']['MenuMode']
export type MenuItemType = components['schemas']['MenuItemType']
export type MenuItem = components['schemas']['MenuItemView']
export type MenuTree = components['schemas']['MenuTree']
export type MenuRouteOption = components['schemas']['MenuRouteOption']
export type MenuData = components['schemas']['MenuGetData']
export type SaveMenuItem = components['schemas']['SaveMenuItem']

export function getMenu() {
  return apiClient.postContract('app/menu/get', {})
}

export function saveBusinessMenu(
  input: components['schemas']['SaveBusinessMenuRequest'],
) {
  return apiClient.postContract('app/menu/save-business-template', input)
}

export function publishBusinessMenu(
  input: components['schemas']['PublishBusinessMenuRequest'],
) {
  return apiClient.postContract('app/menu/publish-business-template', input)
}

export function activateMenu(
  input: components['schemas']['ActivateMenuRequest'],
) {
  return apiClient.postContract('app/menu/activate', input)
}

export function resetBusinessMenu(
  input: components['schemas']['ResetBusinessMenuRequest'],
) {
  return apiClient.postContract('app/menu/reset-business-template', input)
}
