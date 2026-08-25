/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { VouAssetAcquisitionLineInput } from './VouAssetAcquisitionLineInput';
import type { VouAssetLiquidationLineInput } from './VouAssetLiquidationLineInput';
import type { VouAssetSaleLineInput } from './VouAssetSaleLineInput';
import type { VouBillCashLineInput } from './VouBillCashLineInput';
import type { VouBillLineInput } from './VouBillLineInput';
import type { VouEntity } from './VouEntity';
import type { VouFormulaInput } from './VouFormulaInput';
import type { VouIntermediaryCalculationInput } from './VouIntermediaryCalculationInput';
import type { VouInventoryCountLineInput } from './VouInventoryCountLineInput';
import type { VouPriceLineInput } from './VouPriceLineInput';
import type { VouProductionOutputInput } from './VouProductionOutputInput';
import type { VouServiceAcceptanceInput } from './VouServiceAcceptanceInput';
import type { VouServiceContractInput } from './VouServiceContractInput';
export type VouCreateRequest = {
  parentEntity?: VouEntity;
  parentDocumentId?: string;
  data: {
    businessDate?: string;
    currency?: string;
    remark?: string;
    returnReason?: string;
    specialApproval?: boolean;
    intermediaryCalculation?: VouIntermediaryCalculationInput;
    serviceContract?: VouServiceContractInput;
    serviceAcceptance?: VouServiceAcceptanceInput;
    customer?: {
      objectId: string;
      approvalEntryId: string;
    };
    supplier?: {
      objectId: string;
      approvalEntryId: string;
    };
    counterpartyType?: 'customer-account' | 'supplier' | 'other-unit' | 'employee' | 'sales-partner';
    otherCategory?: 'COMMISSION' | 'INTERMEDIARY' | 'REBATE';
    counterparty?: {
      objectId: string;
      approvalEntryId: string;
    };
    settlementMethod?: {
      objectId: string;
      approvalEntryId: string;
    };
    employee?: {
      objectId: string;
      approvalEntryId: string;
    };
    salesperson?: {
      objectId: string;
      approvalEntryId: string;
    };
    purchaser?: {
      objectId: string;
      approvalEntryId: string;
    };
    handler?: {
      objectId: string;
      approvalEntryId: string;
    };
    warehouse?: {
      objectId: string;
      approvalEntryId: string;
    };
    materialWarehouse?: {
      objectId: string;
      approvalEntryId: string;
    };
    finishedWarehouse?: {
      objectId: string;
      approvalEntryId: string;
    };
    productionLines?: Array<VouProductionOutputInput>;
    assetAcquisitionLines?: Array<VouAssetAcquisitionLineInput>;
    assetSaleLines?: Array<VouAssetSaleLineInput>;
    assetLiquidationLines?: Array<VouAssetLiquidationLineInput>;
    carrier?: {
      objectId: string;
      approvalEntryId: string;
    };
    vehicle?: {
      objectId: string;
      approvalEntryId: string;
    };
    fundAccount?: {
      objectId: string;
      approvalEntryId: string;
    };
    sourceName?: string;
    amount?: string;
    internalCostRateBps?: number;
    interestMode?: 'BANK_DEDUCTED' | 'THIRD_PARTY_PAYABLE';
    maturityType?: 'RECEIPT' | 'PAYMENT';
    interestParty?: {
      objectId: string;
      approvalEntryId: string;
    };
    withRecourse?: boolean;
    billLines?: Array<VouBillLineInput>;
    billCashLines?: Array<VouBillCashLineInput>;
    productLines?: Array<{
      product: {
        objectId: string;
      };
      enteredQuantity: string;
      enteredUnit: {
        objectId: string;
      };
      baseQuantity: string;
      unitPrice: string;
      settlementSurcharge?: string | null;
      purchaseUnitPrice?: string;
      remark?: string;
      deliverySpecificationType?: 'PACKAGED' | 'BULK_LIQUID';
      containerType?: string | null;
      quantityPerContainer?: string | null;
      formula?: VouFormulaInput | null;
    }>;
    priceLines?: Array<VouPriceLineInput>;
    expenseLines?: Array<{
      category: string;
      description: string;
      amount: string;
      remark?: string;
    }>;
    inventoryCountLines?: Array<VouInventoryCountLineInput>;
    sourceLines?: Array<{
      sourceLineId: string;
      baseQuantity: string;
      remark?: string;
    }>;
    signoffLines?: Array<{
      sourceLineId: string;
      signedBaseQuantity: string;
      rejectedBaseQuantity: string;
      remark?: string;
    }>;
    returnLines?: Array<{
      sourceLineId: string;
      baseQuantity: string;
      remark?: string;
    }>;
  };
};
