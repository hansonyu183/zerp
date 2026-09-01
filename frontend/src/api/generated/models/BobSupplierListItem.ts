/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DclBusinessArchiveSnapshot } from './DclBusinessArchiveSnapshot';
export type BobSupplierListItem = {
  objectId: string;
  code: string;
  legalName: string;
  displayName?: string | null;
  defaultOperatingEntity: DclBusinessArchiveSnapshot;
  enabled: boolean;
  sourceApprovalEntryId: string;
  sourceVersionNo: number;
  updatedAt: string;
};
