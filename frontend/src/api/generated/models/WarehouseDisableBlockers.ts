/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BobActiveReferenceCount } from './BobActiveReferenceCount';
import type { WarehouseDocumentConflict } from './WarehouseDocumentConflict';
import type { WarehouseInventoryConflict } from './WarehouseInventoryConflict';
export type WarehouseDisableBlockers = {
  inventory: Array<WarehouseInventoryConflict>;
  documents: Array<WarehouseDocumentConflict>;
  sources: Array<WarehouseDocumentConflict>;
  references: Array<BobActiveReferenceCount>;
};

