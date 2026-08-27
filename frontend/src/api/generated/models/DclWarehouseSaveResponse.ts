/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DclOperatingEntityMutation } from './DclOperatingEntityMutation';
import type { DclWarehouseDisableBlockers } from './DclWarehouseDisableBlockers';
export type DclWarehouseSaveResponse = {
  code: number;
  errorKey: string;
  message: string;
  data: (DclOperatingEntityMutation | DclWarehouseDisableBlockers) | null;
  requestId: string;
};
