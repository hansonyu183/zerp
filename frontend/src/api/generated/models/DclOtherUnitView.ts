/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalLifecycleAction } from './ApprovalLifecycleAction';
import type { ApprovalVersionMeta } from './ApprovalVersionMeta';
import type { DclOtherUnitData } from './DclOtherUnitData';
export type DclOtherUnitView = {
  objectId: string;
  entity: 'other-unit';
  code: string;
  approval: ApprovalVersionMeta;
  availableApprovalActions: Array<ApprovalLifecycleAction>;
  data: DclOtherUnitData;
  updatedAt: string;
};
