/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { VouAssetAcquisitionLineInput } from './VouAssetAcquisitionLineInput';
import type { VouAssetLiquidationLineInput } from './VouAssetLiquidationLineInput';
import type { VouAssetSaleLineInput } from './VouAssetSaleLineInput';
import type { VouBillCashLineInput } from './VouBillCashLineInput';
import type { VouBillLineInput } from './VouBillLineInput';
import type { VouFormulaInput } from './VouFormulaInput';
import type { VouIntermediaryCalculationInput } from './VouIntermediaryCalculationInput';
import type { VouInventoryCountLineInput } from './VouInventoryCountLineInput';
import type { VouPriceLineInput } from './VouPriceLineInput';
import type { VouProductionOutputInput } from './VouProductionOutputInput';
import type { VouServiceAcceptanceInput } from './VouServiceAcceptanceInput';
import type { VouServiceContractInput } from './VouServiceContractInput';
export type VouSaveRequest = {
  documentId: string;
  revision: number;
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
      versionId: string;
    };
    supplier?: {
      objectId: string;
      versionId: string;
    };
    counterpartyType?: 'customer-account' | 'supplier' | 'other-unit' | 'employee' | 'sales-partner';
    otherCategory?: 'COMMISSION' | 'INTERMEDIARY' | 'REBATE';
    counterparty?: {
      objectId: string;
      versionId: string;
    };
    settlementMethod?: {
      objectId: string;
      versionId: string;
    };
    employee?: {
      objectId: string;
      versionId: string;
    };
    salesperson?: {
      objectId: string;
      versionId: string;
    };
    purchaser?: {
      objectId: string;
      versionId: string;
    };
    handler?: {
      objectId: string;
      versionId: string;
    };
    warehouse?: {
      objectId: string;
      versionId: string;
    };
    materialWarehouse?: {
      objectId: string;
      versionId: string;
    };
    finishedWarehouse?: {
      objectId: string;
      versionId: string;
    };
    productionLines?: Array<VouProductionOutputInput>;
    assetAcquisitionLines?: Array<VouAssetAcquisitionLineInput>;
    assetSaleLines?: Array<VouAssetSaleLineInput>;
    assetLiquidationLines?: Array<VouAssetLiquidationLineInput>;
    carrier?: {
      objectId: string;
      versionId: string;
    };
    vehicle?: {
      objectId: string;
      versionId: string;
    };
    fundAccount?: {
      objectId: string;
      versionId: string;
    };
    sourceName?: string;
    amount?: string;
    internalCostRateBps?: number;
    interestMode?: 'BANK_DEDUCTED' | 'THIRD_PARTY_PAYABLE';
    maturityType?: 'RECEIPT' | 'PAYMENT';
    interestParty?: {
      objectId: string;
      versionId: string;
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
