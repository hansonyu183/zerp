/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { VouIntermediaryReference } from './VouIntermediaryReference';
import type { VouIntermediarySalesContractSnapshot } from './VouIntermediarySalesContractSnapshot';
export type VouIntermediarySourceLine = {
  sourceSignoffLineId: string;
  sourceKind: 'SALE' | 'RETURN_ADJUSTMENT';
  signoffDocumentId: string;
  signoffDocumentNo: string;
  signoffDate: string;
  orderDocumentId: string;
  orderDocumentNo: string;
  orderDate: string;
  dueDate: string;
  collectionDate: string;
  collectionDelayDays: number;
  customer: VouIntermediaryReference;
  salesperson: VouIntermediaryReference;
  salesAttributionType: 'INTERNAL_EMPLOYEE' | 'EXTERNAL_PART_TIME' | 'CHANNEL_PARTNER';
  salesContractStatus: 'NOT_REQUIRED' | 'MISSING' | 'APPLICABLE';
  salesContract?: VouIntermediarySalesContractSnapshot;
  intermediary?: VouIntermediaryReference;
  product: VouIntermediaryReference;
  behaviorProfile: 'RAW_MATERIAL' | 'STANDARD_FINISHED' | 'CUSTOM_FINISHED' | 'PACKAGING';
  signedBaseQuantity: string;
  pricingQuantity: string;
  standardPieceQuantity: string;
  unitPrice: string;
  referenceUnitPrice: string;
  settlementSurcharge: string;
  rebateUnitPrice: string;
  lineAmount: string;
  settlementTermCode: string;
  specialApproval: boolean;
  returnDocumentNos?: Array<string>;
  adjustmentEmployeeAmount: string;
  adjustmentIntermediaryAmount: string;
  adjustmentRebateAmount: string;
};

