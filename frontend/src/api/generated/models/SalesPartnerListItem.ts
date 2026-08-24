/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { PartyKind } from './PartyKind';
import type { SalesPartnerListVersion } from './SalesPartnerListVersion';
export type SalesPartnerListItem = {
  objectId: string;
  code: string;
  objectRevision: number;
  enabled: boolean;
  partyId: string;
  partyKind: PartyKind;
  partyDisplayName: string;
  operatingEntityId: string;
  operatingEntityCode: string;
  operatingEntityName: string;
  effective: SalesPartnerListVersion | null;
  candidate: SalesPartnerListVersion | null;
  updatedAt: string;
};

