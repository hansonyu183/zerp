/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalLifecycleAction } from './ApprovalLifecycleAction';
import type { DclBusinessArchiveSnapshot } from './DclBusinessArchiveSnapshot';
import type { DclEmployeeVersionView } from './DclEmployeeVersionView';
export type DclEmployeeListItem = {
  objectId: string;
  entity: 'employee';
  code: string;
  displayName: string;
  currentOperatingEntity: DclBusinessArchiveSnapshot;
  availableApprovalActions: Array<ApprovalLifecycleAction>;
  latestApproved: DclEmployeeVersionView | null;
  openVersion: DclEmployeeVersionView | null;
  updatedAt: string;
};
