/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { PartyIdentifier } from './PartyIdentifier';
import type { PartyKind } from './PartyKind';
export type PartySaveRequest = {
  partyId: string;
  revision: number;
  data: {
    kind?: PartyKind;
    legalName?: string | null;
    displayName?: string | null;
    taxNumber?: string | null;
    strongIdentifiers?: Array<PartyIdentifier>;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
  };
};

