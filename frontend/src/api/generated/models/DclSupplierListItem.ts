/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalLifecycleAction } from './ApprovalLifecycleAction';
import type { DclBusinessArchiveSnapshot } from './DclBusinessArchiveSnapshot';
import type { DclSupplierVersionView } from './DclSupplierVersionView';
export type DclSupplierListItem = {
  objectId: string;
  entity: 'supplier';
  code: string;
  displayName: string;
  defaultOperatingEntity: DclBusinessArchiveSnapshot;
  availableApprovalActions: Array<ApprovalLifecycleAction>;
  latestApproved: DclSupplierVersionView | null;
  openVersion: DclSupplierVersionView | null;
  updatedAt: string;
};
