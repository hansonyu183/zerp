/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { PartyKind } from './PartyKind';
export type DclRelationshipListIdentity = {
  objectId: string;
  entity: 'other-unit' | 'sales-partner';
  code: string;
  objectRevision: number;
  partyId: string;
  partyKind: PartyKind;
  partyDisplayName: string;
  operatingEntityId: string;
  operatingEntityCode: string;
  operatingEntityName: string;
  enabled: boolean;
};
