/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { VouEntity } from './VouEntity';
import type { VouPurchaseBaseQuantitySummary } from './VouPurchaseBaseQuantitySummary';
import type { VouSalesBaseQuantitySummary } from './VouSalesBaseQuantitySummary';
import type { VouStatus } from './VouStatus';
export type VouListItem = {
  documentId: string;
  entity: VouEntity;
  documentNo: string;
  status: VouStatus;
  revision: number;
  businessDate: string;
  partyName?: string;
  currency: string;
  amount: string;
  updatedAt: string;
  salesSummary?: VouSalesBaseQuantitySummary;
  purchaseSummary?: VouPurchaseBaseQuantitySummary;
};

