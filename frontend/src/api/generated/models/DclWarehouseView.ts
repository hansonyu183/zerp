/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalVersionMeta } from './ApprovalVersionMeta';
import type { DclWarehouseData } from './DclWarehouseData';
export type DclWarehouseView = {
  objectId: string;
  entity: 'warehouse';
  code: string;
  enabled: boolean;
  approval: ApprovalVersionMeta;
  data: DclWarehouseData;
  updatedAt: string;
};
