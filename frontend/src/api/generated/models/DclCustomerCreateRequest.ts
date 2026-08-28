/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DclCustomerAccountInput } from './DclCustomerAccountInput';
import type { PartyIdentityData } from './PartyIdentityData';
export type DclCustomerCreateRequest = ({
  partyId: string;
  operatingEntityId: string;
  defaultAccount: DclCustomerAccountInput;
} | {
  newParty: PartyIdentityData;
  operatingEntityId: string;
  defaultAccount: DclCustomerAccountInput;
});
