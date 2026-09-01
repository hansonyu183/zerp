/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalLifecycleAction } from './ApprovalLifecycleAction';
import type { ApprovalVersionMeta } from './ApprovalVersionMeta';
import type { DclSalesPartnerData } from './DclSalesPartnerData';
export type DclSalesPartnerView = {
  objectId: string;
  entity: 'sales-partner';
  code: string;
  approval: ApprovalVersionMeta;
  availableApprovalActions: Array<ApprovalLifecycleAction>;
  data: DclSalesPartnerData;
  updatedAt: string;
};
