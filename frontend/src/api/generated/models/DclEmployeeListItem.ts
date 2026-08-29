/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DclEmployeeVersionView } from './DclEmployeeVersionView';
import type { PartyKind } from './PartyKind';
export type DclEmployeeListItem = {
  objectId: string;
  entity: 'employee';
  code: string;
  partyId: string;
  partyKind: PartyKind;
  partyDisplayName: string;
  operatingEntityId: string;
  operatingEntityCode: string;
  operatingEntityName: string;
  enabled: boolean;
  latestApproved: DclEmployeeVersionView | null;
  openVersion: DclEmployeeVersionView | null;
  updatedAt: string;
};
