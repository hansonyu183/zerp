/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalStatus } from './ApprovalStatus';
import type { VouEntity } from './VouEntity';
export type DclWarehouseDocumentConflict = {
  documentId: string;
  entity: VouEntity;
  documentNo: string;
  status?: ApprovalStatus;
};
