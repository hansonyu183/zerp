import type { Component } from 'vue'

import type { VouEntity } from '@zerp/model'

import SalePricing from '../sale-pricing/SalePricing.vue'
import SaleOrder from '../sale-order/SaleOrder.vue'
import SaleOutbound from '../sale-outbound/SaleOutbound.vue'
import SaleDelivery from '../sale-delivery/SaleDelivery.vue'
import SaleSignoff from '../sale-signoff/SaleSignoff.vue'
import SaleReturn from '../sale-return/SaleReturn.vue'
import PurchaseOrder from '../purchase-order/PurchaseOrder.vue'
import PurchaseInbound from '../purchase-inbound/PurchaseInbound.vue'
import PurchaseReturn from '../purchase-return/PurchaseReturn.vue'
import PurchaseInquiry from '../purchase-inquiry/PurchaseInquiry.vue'
import OrderProduction from '../order-production/OrderProduction.vue'
import SelfProduction from '../self-production/SelfProduction.vue'
import InventoryCount from '../inventory-count/InventoryCount.vue'
import SalesReceipt from '../sales-receipt/SalesReceipt.vue'
import PurchaseRefund from '../purchase-refund/PurchaseRefund.vue'
import OtherReceipt from '../other-receipt/OtherReceipt.vue'
import SalesRefund from '../sales-refund/SalesRefund.vue'
import PurchasePayment from '../purchase-payment/PurchasePayment.vue'
import OtherPayment from '../other-payment/OtherPayment.vue'
import EmployeeLoan from '../employee-loan/EmployeeLoan.vue'
import EmployeeRepayment from '../employee-repayment/EmployeeRepayment.vue'
import EmployeeLoanWriteoff from '../employee-loan-writeoff/EmployeeLoanWriteoff.vue'
import ExpenseReimbursement from '../expense-reimbursement/ExpenseReimbursement.vue'
import ExpensePayment from '../expense-payment/ExpensePayment.vue'
import OtherIncome from '../other-income/OtherIncome.vue'
import AssetAcquisition from '../asset-acquisition/AssetAcquisition.vue'
import AssetSale from '../asset-sale/AssetSale.vue'
import AssetLiquidation from '../asset-liquidation/AssetLiquidation.vue'
import BillReceipt from '../bill-receipt/BillReceipt.vue'
import BillPayment from '../bill-payment/BillPayment.vue'
import BillIssue from '../bill-issue/BillIssue.vue'
import BillDiscount from '../bill-discount/BillDiscount.vue'
import BillMaturity from '../bill-maturity/BillMaturity.vue'
import IntermediaryCalculation from '../intermediary-calculation/IntermediaryCalculation.vue'
import ServiceContract from '../service-contract/ServiceContract.vue'
import ServiceAcceptance from '../service-acceptance/ServiceAcceptance.vue'

/** Typed page registry consumed by the shared router during the wiring slice. */
export const vouPageComponents = {
  'sale-pricing': SalePricing,
  'sale-order': SaleOrder,
  'sale-outbound': SaleOutbound,
  'sale-delivery': SaleDelivery,
  'sale-signoff': SaleSignoff,
  'sale-return': SaleReturn,
  'purchase-order': PurchaseOrder,
  'purchase-inbound': PurchaseInbound,
  'purchase-return': PurchaseReturn,
  'purchase-inquiry': PurchaseInquiry,
  'order-production': OrderProduction,
  'self-production': SelfProduction,
  'inventory-count': InventoryCount,
  'sales-receipt': SalesReceipt,
  'purchase-refund': PurchaseRefund,
  'other-receipt': OtherReceipt,
  'sales-refund': SalesRefund,
  'purchase-payment': PurchasePayment,
  'other-payment': OtherPayment,
  'employee-loan': EmployeeLoan,
  'employee-repayment': EmployeeRepayment,
  'employee-loan-writeoff': EmployeeLoanWriteoff,
  'expense-reimbursement': ExpenseReimbursement,
  'expense-payment': ExpensePayment,
  'other-income': OtherIncome,
  'asset-acquisition': AssetAcquisition,
  'asset-sale': AssetSale,
  'asset-liquidation': AssetLiquidation,
  'bill-receipt': BillReceipt,
  'bill-payment': BillPayment,
  'bill-issue': BillIssue,
  'bill-discount': BillDiscount,
  'bill-maturity': BillMaturity,
  'intermediary-calculation': IntermediaryCalculation,
  'service-contract': ServiceContract,
  'service-acceptance': ServiceAcceptance,
} as const satisfies Record<VouEntity, Component>
