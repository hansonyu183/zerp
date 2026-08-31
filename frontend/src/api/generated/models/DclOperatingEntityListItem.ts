/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalLifecycleAction } from './ApprovalLifecycleAction';
import type { DclOperatingEntityVersionView } from './DclOperatingEntityVersionView';
export type DclOperatingEntityListItem = {
  objectId: string;
  entity: 'operating-entity';
  code: string;
  enabled: boolean;
  availableApprovalActions: Array<ApprovalLifecycleAction>;
  latestApproved: DclOperatingEntityVersionView | null;
  openVersion: DclOperatingEntityVersionView | null;
  updatedAt: string;
};
