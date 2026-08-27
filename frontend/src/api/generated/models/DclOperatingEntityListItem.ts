/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DclOperatingEntityVersionView } from './DclOperatingEntityVersionView';
export type DclOperatingEntityListItem = {
  objectId: string;
  entity: 'operating-entity';
  code: string;
  objectRevision: number;
  enabled: boolean;
  latestApproved: DclOperatingEntityVersionView | null;
  openVersion: DclOperatingEntityVersionView | null;
  updatedAt: string;
};
