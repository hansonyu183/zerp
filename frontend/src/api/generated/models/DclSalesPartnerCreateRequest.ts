/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DclSalesPartnerInput } from './DclSalesPartnerInput';
import type { PartyIdentityData } from './PartyIdentityData';
export type DclSalesPartnerCreateRequest = ({
  partyId: string;
  operatingEntityId: string;
  data: DclSalesPartnerInput;
} | {
  newParty: PartyIdentityData;
  operatingEntityId: string;
  data: DclSalesPartnerInput;
});
