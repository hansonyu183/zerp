/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { PartyKind } from './PartyKind';
import type { SalesPartnerVersionView } from './SalesPartnerVersionView';
export type SalesPartnerDetailView = {
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
  effective: SalesPartnerVersionView | null;
  candidate: SalesPartnerVersionView | null;
  updatedAt: string;
};

