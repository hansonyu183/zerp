/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalLifecycleAction } from './ApprovalLifecycleAction';
import type { DclCustomerVersionSummary } from './DclCustomerVersionSummary';
export type DclCustomerListItem = {
  objectId: string;
  entity: 'customer';
  code: string;
  displayName: string;
  defaultOperatingEntityCode: string;
  defaultOperatingEntityName: string;
  enabled: boolean;
  availableApprovalActions: Array<ApprovalLifecycleAction>;
  latestApproved: DclCustomerVersionSummary | null;
  openVersion: DclCustomerVersionSummary | null;
  updatedAt: string;
};
