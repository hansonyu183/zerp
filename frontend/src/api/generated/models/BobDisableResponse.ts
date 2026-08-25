/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BobActiveReferenceBlockers } from './BobActiveReferenceBlockers';
import type { BobMutationResult } from './BobMutationResult';
import type { WarehouseDisableBlockers } from './WarehouseDisableBlockers';
export type BobDisableResponse = {
  code: number;
  errorKey: string;
  message: string;
  data: (WarehouseDisableBlockers | BobActiveReferenceBlockers | BobMutationResult) | null;
  requestId: string;
};
