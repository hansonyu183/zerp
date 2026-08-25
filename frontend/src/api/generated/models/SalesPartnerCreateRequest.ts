/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { PartyIdentityData } from './PartyIdentityData';
import type { SalesPartnerInput } from './SalesPartnerInput';
export type SalesPartnerCreateRequest = ({
  partyId: string;
  data: SalesPartnerInput;
} | {
  newParty: PartyIdentityData;
  data: SalesPartnerInput;
});
