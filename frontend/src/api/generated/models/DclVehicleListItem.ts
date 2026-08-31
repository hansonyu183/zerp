/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalLifecycleAction } from './ApprovalLifecycleAction';
import type { DclVehicleVersionView } from './DclVehicleVersionView';
export type DclVehicleListItem = {
  objectId: string;
  entity: 'vehicle';
  code: string;
  enabled: boolean;
  availableApprovalActions: Array<ApprovalLifecycleAction>;
  latestApproved: DclVehicleVersionView | null;
  openVersion: DclVehicleVersionView | null;
  updatedAt: string;
};
