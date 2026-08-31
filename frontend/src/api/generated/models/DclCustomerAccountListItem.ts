/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalLifecycleAction } from './ApprovalLifecycleAction';
import type { DclCustomerAccountVersionView } from './DclCustomerAccountVersionView';
export type DclCustomerAccountListItem = {
  objectId: string;
  entity: 'customer-account';
  code: string;
  customerRelationshipId: string;
  enabled: boolean;
  availableApprovalActions: Array<ApprovalLifecycleAction>;
  latestApproved: DclCustomerAccountVersionView | null;
  openVersion: DclCustomerAccountVersionView | null;
  updatedAt: string;
};
