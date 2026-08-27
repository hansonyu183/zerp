/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalVersionMeta } from './ApprovalVersionMeta';
import type { DclPartyData } from './DclPartyData';
import type { PartyRelationshipCard } from './PartyRelationshipCard';
export type DclPartyView = {
  partyId: string;
  entity: 'party';
  approval: ApprovalVersionMeta;
  data: DclPartyData;
  impactRelationships: Array<PartyRelationshipCard>;
  mergedIntoPartyId?: string | null;
  updatedAt: string;
};
