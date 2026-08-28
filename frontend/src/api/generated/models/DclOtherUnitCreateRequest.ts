/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DclOtherUnitInput } from './DclOtherUnitInput';
import type { PartyIdentityData } from './PartyIdentityData';
export type DclOtherUnitCreateRequest = ({
  partyId: string;
  operatingEntityId: string;
  data: DclOtherUnitInput;
} | {
  newParty: PartyIdentityData;
  operatingEntityId: string;
  data: DclOtherUnitInput;
});
