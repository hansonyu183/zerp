/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalLifecycleAction } from './ApprovalLifecycleAction';
import type { ApprovalVersionMeta } from './ApprovalVersionMeta';
import type { DclEmployeeData } from './DclEmployeeData';
export type DclEmployeeView = {
  objectId: string;
  entity: 'employee';
  code: string;
  approval: ApprovalVersionMeta;
  availableApprovalActions: Array<ApprovalLifecycleAction>;
  data: DclEmployeeData;
  updatedAt: string;
};
