/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CustomerAccountInput } from './CustomerAccountInput';
import type { PartyIdentityData } from './PartyIdentityData';
export type CustomerCreateRequest = ({
  partyId: string;
  data: CustomerAccountInput;
} | {
  newParty: PartyIdentityData;
  data: CustomerAccountInput;
});

