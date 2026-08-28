/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalVersionMeta } from './ApprovalVersionMeta';
import type { DclRelationshipListIdentity } from './DclRelationshipListIdentity';
import type { DclSalesPartnerInput } from './DclSalesPartnerInput';
export type DclSalesPartnerView = (DclRelationshipListIdentity & {
  approval: ApprovalVersionMeta;
  data: DclSalesPartnerInput;
  updatedAt: string;
});
