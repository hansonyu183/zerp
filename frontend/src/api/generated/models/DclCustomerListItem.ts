/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalLifecycleAction } from './ApprovalLifecycleAction';
import type { DclCustomerVersionView } from './DclCustomerVersionView';
import type { PartyKind } from './PartyKind';
export type DclCustomerListItem = {
  objectId: string;
  entity: 'customer';
  code: string;
  partyId: string;
  partyKind: PartyKind;
  partyDisplayName: string;
  operatingEntityId: string;
  operatingEntityCode: string;
  operatingEntityName: string;
  enabled: boolean;
  availableApprovalActions: Array<ApprovalLifecycleAction>;
  latestApproved: DclCustomerVersionView | null;
  openVersion: DclCustomerVersionView | null;
  updatedAt: string;
};
