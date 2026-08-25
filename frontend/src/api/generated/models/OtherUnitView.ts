/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalVersionMeta } from './ApprovalVersionMeta';
import type { OtherUnitData } from './OtherUnitData';
import type { PartyKind } from './PartyKind';
export type OtherUnitView = {
  objectId: string;
  code: string;
  objectRevision: number;
  enabled: boolean;
  approval: ApprovalVersionMeta;
  partyId: string;
  partyKind: PartyKind;
  partyDisplayName: string;
  operatingEntityId: string;
  operatingEntityCode: string;
  operatingEntityName: string;
  data: OtherUnitData;
  updatedAt: string;
};
