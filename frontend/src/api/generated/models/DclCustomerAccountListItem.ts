/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DclCustomerAccountVersionView } from './DclCustomerAccountVersionView';
export type DclCustomerAccountListItem = {
  objectId: string;
  entity: 'customer-account';
  code: string;
  customerRelationshipId: string;
  objectRevision: number;
  enabled: boolean;
  latestApproved: DclCustomerAccountVersionView | null;
  openVersion: DclCustomerAccountVersionView | null;
  updatedAt: string;
};
