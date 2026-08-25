/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { MenuMode } from './MenuMode';
import type { MenuRouteOption } from './MenuRouteOption';
import type { MenuTree } from './MenuTree';
export type MenuGetData = {
  mode: MenuMode;
  revision: number;
  defaultMenu: MenuTree;
  businessMenu: MenuTree;
  navigation: MenuTree;
  availableRoutes: Array<MenuRouteOption>;
};
