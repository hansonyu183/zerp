/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalVersionMeta } from './ApprovalVersionMeta';
import type { DclEmployeeData } from './DclEmployeeData';
import type { PartyKind } from './PartyKind';
export type DclEmployeeView = {
  objectId: string;
  entity: 'employee';
  code: string;
  partyId: string;
  partyKind: PartyKind;
  partyDisplayName: string;
  operatingEntityId: string;
  operatingEntityApprovalEntryId?: string;
  operatingEntityCode: string;
  operatingEntityName: string;
  objectRevision: number;
  enabled: boolean;
  approval: ApprovalVersionMeta;
  data: DclEmployeeData;
  updatedAt: string;
};
