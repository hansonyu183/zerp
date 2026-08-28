/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DclEmployeeInput } from './DclEmployeeInput';
import type { PartyIdentityData } from './PartyIdentityData';
export type DclEmployeeCreateRequest = ({
  partyId: string;
  operatingEntityId: string;
  data: DclEmployeeInput;
} | {
  newParty: PartyIdentityData;
  operatingEntityId: string;
  data: DclEmployeeInput;
});
