/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalVersionMeta } from './ApprovalVersionMeta';
import type { DclProductData } from './DclProductData';
export type DclProductView = {
  objectId: string;
  entity: 'product';
  code: string;
  enabled: boolean;
  approval: ApprovalVersionMeta;
  data: DclProductData;
  updatedAt: string;
};
