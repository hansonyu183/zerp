/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { PartyKind } from './PartyKind';
import type { SupplierVersionView } from './SupplierVersionView';
export type SupplierDetailView = {
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
  latestApproved: SupplierVersionView | null;
  openVersion: SupplierVersionView | null;
  updatedAt: string;
};
