/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalLifecycleAction } from './ApprovalLifecycleAction';
import type { DclRelationshipListIdentity } from './DclRelationshipListIdentity';
import type { DclSalesPartnerVersionView } from './DclSalesPartnerVersionView';
export type DclSalesPartnerListItem = (DclRelationshipListIdentity & {
  availableApprovalActions: Array<ApprovalLifecycleAction>;
  latestApproved?: DclSalesPartnerVersionView | null;
  openVersion?: DclSalesPartnerVersionView | null;
});
