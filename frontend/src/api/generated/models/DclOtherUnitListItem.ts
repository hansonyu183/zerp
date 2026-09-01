/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalLifecycleAction } from './ApprovalLifecycleAction';
import type { DclBusinessArchiveSnapshot } from './DclBusinessArchiveSnapshot';
import type { DclOtherUnitVersionView } from './DclOtherUnitVersionView';
export type DclOtherUnitListItem = {
  objectId: string;
  entity: 'other-unit';
  code: string;
  displayName: string;
  defaultOperatingEntity: DclBusinessArchiveSnapshot;
  availableApprovalActions: Array<ApprovalLifecycleAction>;
  latestApproved: DclOtherUnitVersionView | null;
  openVersion: DclOtherUnitVersionView | null;
  updatedAt: string;
};
