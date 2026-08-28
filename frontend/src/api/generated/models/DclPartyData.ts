/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { PartyIdentifier } from './PartyIdentifier';
import type { PartyKind } from './PartyKind';
export type DclPartyData = {
  kind: PartyKind;
  legalName: string;
  displayName?: string;
  taxNumber?: string;
  strongIdentifiers: Array<PartyIdentifier>;
  phone?: string;
  email?: string;
  address?: string;
};
