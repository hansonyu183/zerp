/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalLifecycleAction } from './ApprovalLifecycleAction';
import type { ApprovalStatus } from './ApprovalStatus';
import type { VouEntity } from './VouEntity';
import type { VouPurchaseBaseQuantitySummary } from './VouPurchaseBaseQuantitySummary';
import type { VouSalesBaseQuantitySummary } from './VouSalesBaseQuantitySummary';
export type VouListItem = {
  documentId: string;
  entity: VouEntity;
  documentNo: string;
  status: ApprovalStatus;
  revision: number;
  businessDate: string;
  partyName?: string;
  currency: string;
  amount: string;
  updatedAt: string;
  availableApprovalActions: Array<ApprovalLifecycleAction>;
  salesSummary?: VouSalesBaseQuantitySummary;
  purchaseSummary?: VouPurchaseBaseQuantitySummary;
};
