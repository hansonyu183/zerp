/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalLifecycleAction } from './ApprovalLifecycleAction';
import type { DclOtherUnitVersionView } from './DclOtherUnitVersionView';
import type { DclRelationshipListIdentity } from './DclRelationshipListIdentity';
export type DclOtherUnitListItem = (DclRelationshipListIdentity & {
  availableApprovalActions: Array<ApprovalLifecycleAction>;
  latestApproved?: DclOtherUnitVersionView | null;
  openVersion?: DclOtherUnitVersionView | null;
});
