/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalLifecycleAction } from './ApprovalLifecycleAction';
import type { DclBusinessArchiveSnapshot } from './DclBusinessArchiveSnapshot';
import type { DclSalesPartnerVersionView } from './DclSalesPartnerVersionView';
export type DclSalesPartnerListItem = {
  objectId: string;
  entity: 'sales-partner';
  code: string;
  displayName: string;
  defaultOperatingEntity: DclBusinessArchiveSnapshot;
  availableApprovalActions: Array<ApprovalLifecycleAction>;
  latestApproved: DclSalesPartnerVersionView | null;
  openVersion: DclSalesPartnerVersionView | null;
  updatedAt: string;
};
