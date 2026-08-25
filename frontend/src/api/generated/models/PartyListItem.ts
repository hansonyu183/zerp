/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { PartyKind } from './PartyKind';
export type PartyListItem = {
  partyId: string;
  kind: PartyKind;
  legalName: string;
  displayName: string;
  revision: number;
  mergedIntoPartyId?: string;
  mergedAt?: string;
  updatedAt: string;
};
