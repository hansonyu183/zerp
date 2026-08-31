/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalLifecycleAction } from './ApprovalLifecycleAction';
import type { DclPartyVersionView } from './DclPartyVersionView';
export type DclPartyListItem = {
  partyId: string;
  entity: 'party';
  availableApprovalActions: Array<ApprovalLifecycleAction>;
  latestApproved: DclPartyVersionView | null;
  openVersion: DclPartyVersionView | null;
  mergedIntoPartyId?: string | null;
  updatedAt: string;
};
