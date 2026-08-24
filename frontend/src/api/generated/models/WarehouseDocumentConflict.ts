/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { VouEntity } from './VouEntity';
import type { VouStatus } from './VouStatus';
export type WarehouseDocumentConflict = {
  documentId: string;
  entity: VouEntity;
  documentNo: string;
  status?: VouStatus;
};

