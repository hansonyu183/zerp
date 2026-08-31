/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalLifecycleAction } from './ApprovalLifecycleAction';
import type { DclSupplierVersionView } from './DclSupplierVersionView';
import type { PartyKind } from './PartyKind';
export type DclSupplierListItem = {
  objectId: string;
  entity: 'supplier';
  code: string;
  partyId: string;
  partyKind: PartyKind;
  partyDisplayName: string;
  operatingEntityId: string;
  operatingEntityCode: string;
  operatingEntityName: string;
  enabled: boolean;
  availableApprovalActions: Array<ApprovalLifecycleAction>;
  latestApproved: DclSupplierVersionView | null;
  openVersion: DclSupplierVersionView | null;
  updatedAt: string;
};
