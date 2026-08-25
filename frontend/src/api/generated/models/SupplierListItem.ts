/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { PartyKind } from './PartyKind';
import type { SupplierListVersion } from './SupplierListVersion';
export type SupplierListItem = {
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
  latestApproved: SupplierListVersion | null;
  openVersion: SupplierListVersion | null;
  updatedAt: string;
};
