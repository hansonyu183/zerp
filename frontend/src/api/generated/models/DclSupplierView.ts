/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalVersionMeta } from './ApprovalVersionMeta';
import type { DclSupplierData } from './DclSupplierData';
import type { PartyKind } from './PartyKind';
export type DclSupplierView = {
  objectId: string;
  entity: 'supplier';
  code: string;
  partyId: string;
  partyKind: PartyKind;
  partyDisplayName: string;
  operatingEntityId: string;
  operatingEntityApprovalEntryId: string;
  operatingEntityCode: string;
  operatingEntityName: string;
  objectRevision: number;
  enabled: boolean;
  approval: ApprovalVersionMeta;
  data: DclSupplierData;
  updatedAt: string;
};
