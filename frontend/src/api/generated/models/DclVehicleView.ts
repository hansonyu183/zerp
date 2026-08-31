/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalLifecycleAction } from './ApprovalLifecycleAction';
import type { ApprovalVersionMeta } from './ApprovalVersionMeta';
import type { DclVehicleData } from './DclVehicleData';
export type DclVehicleView = {
  objectId: string;
  entity: 'vehicle';
  code: string;
  enabled: boolean;
  approval: ApprovalVersionMeta;
  availableApprovalActions: Array<ApprovalLifecycleAction>;
  data: DclVehicleData;
  updatedAt: string;
};
