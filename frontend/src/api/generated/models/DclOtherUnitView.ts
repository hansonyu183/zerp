/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalVersionMeta } from './ApprovalVersionMeta';
import type { DclOtherUnitData } from './DclOtherUnitData';
import type { DclRelationshipListIdentity } from './DclRelationshipListIdentity';
export type DclOtherUnitView = (DclRelationshipListIdentity & {
  approval: ApprovalVersionMeta;
  data: DclOtherUnitData;
  updatedAt: string;
});
