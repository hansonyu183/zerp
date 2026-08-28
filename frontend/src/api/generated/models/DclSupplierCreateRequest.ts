/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DclSupplierInput } from './DclSupplierInput';
import type { PartyIdentityData } from './PartyIdentityData';
export type DclSupplierCreateRequest = ({
  partyId: string;
  operatingEntityId: string;
  data: DclSupplierInput;
} | {
  newParty: PartyIdentityData;
  operatingEntityId: string;
  data: DclSupplierInput;
});
