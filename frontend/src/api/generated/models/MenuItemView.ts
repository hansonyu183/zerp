/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { MenuItemType } from './MenuItemType';
export type MenuItemView = {
  id: string;
  parentId: string | null;
  type: MenuItemType;
  level: number;
  order: number;
  displayName: string;
  icon: string | null;
  enabled: boolean;
  routeKey: string | null;
  routePath: string | null;
  permissionCode: string | null;
};
