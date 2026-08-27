/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalVersionMeta } from './ApprovalVersionMeta';
import type { DclVehicleData } from './DclVehicleData';
export type DclVehicleView = {
  objectId: string;
  entity: 'vehicle';
  code: string;
  objectRevision: number;
  enabled: boolean;
  approval: ApprovalVersionMeta;
  data: DclVehicleData;
  updatedAt: string;
};
