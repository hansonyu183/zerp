/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DclWarehouseDocumentConflict } from './DclWarehouseDocumentConflict';
import type { DclWarehouseInventoryConflict } from './DclWarehouseInventoryConflict';
import type { DclWarehouseReferenceCount } from './DclWarehouseReferenceCount';
export type DclWarehouseDisableBlockers = {
  inventory: Array<DclWarehouseInventoryConflict>;
  documents: Array<DclWarehouseDocumentConflict>;
  sources: Array<DclWarehouseDocumentConflict>;
  references: Array<DclWarehouseReferenceCount>;
};
