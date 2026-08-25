/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { PartyIdentityData } from './PartyIdentityData';
import type { SupplierInput } from './SupplierInput';
export type SupplierCreateRequest = ({
  partyId: string;
  data: SupplierInput;
} | {
  newParty: PartyIdentityData;
  data: SupplierInput;
});
