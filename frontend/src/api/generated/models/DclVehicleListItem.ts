/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DclVehicleVersionView } from './DclVehicleVersionView';
export type DclVehicleListItem = {
  objectId: string;
  entity: 'vehicle';
  code: string;
  objectRevision: number;
  enabled: boolean;
  latestApproved: DclVehicleVersionView | null;
  openVersion: DclVehicleVersionView | null;
  updatedAt: string;
};
