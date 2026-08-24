/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { EmploymentData } from './EmploymentData';
import type { PartyIdentityData } from './PartyIdentityData';
export type EmploymentCreateRequest = ({
  partyId: string;
  data: EmploymentData;
} | {
  newParty: PartyIdentityData;
  data: EmploymentData;
});

