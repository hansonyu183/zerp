/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalLifecycleAction } from './ApprovalLifecycleAction';
import type { ApprovalVersionMeta } from './ApprovalVersionMeta';
import type { DclOtherUnitData } from './DclOtherUnitData';
import type { DclRelationshipListIdentity } from './DclRelationshipListIdentity';
export type DclOtherUnitView = (DclRelationshipListIdentity & {
  approval: ApprovalVersionMeta;
  availableApprovalActions: Array<ApprovalLifecycleAction>;
  data: DclOtherUnitData;
  updatedAt: string;
});
