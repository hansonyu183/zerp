/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DclWarehouseVersionView } from './DclWarehouseVersionView';
export type DclWarehouseListItem = {
  objectId: string;
  entity: 'warehouse';
  code: string;
  enabled: boolean;
  latestApproved: DclWarehouseVersionView | null;
  openVersion: DclWarehouseVersionView | null;
  updatedAt: string;
};
