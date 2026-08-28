/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DclRelationshipListIdentity } from './DclRelationshipListIdentity';
import type { DclSalesPartnerVersionView } from './DclSalesPartnerVersionView';
export type DclSalesPartnerListItem = (DclRelationshipListIdentity & {
  latestApproved?: DclSalesPartnerVersionView | null;
  openVersion?: DclSalesPartnerVersionView | null;
});
