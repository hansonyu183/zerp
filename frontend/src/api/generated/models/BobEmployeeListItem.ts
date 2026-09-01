/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DclBusinessArchiveSnapshot } from './DclBusinessArchiveSnapshot';
export type BobEmployeeListItem = {
  objectId: string;
  code: string;
  legalName: string;
  displayName?: string | null;
  currentOperatingEntity: DclBusinessArchiveSnapshot;
  enabled: boolean;
  sourceApprovalEntryId: string;
  sourceVersionNo: number;
  updatedAt: string;
};
