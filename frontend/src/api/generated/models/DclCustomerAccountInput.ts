/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DclCustomerCreditLimit } from './DclCustomerCreditLimit';
import type { DclCustomerPricingPolicy } from './DclCustomerPricingPolicy';
import type { DclCustomerSalesAttributionInput } from './DclCustomerSalesAttributionInput';
export type DclCustomerAccountInput = {
  name: string;
  shortName?: string | null;
  customerTypeId: string;
  contactName?: string | null;
  contactPhone?: string | null;
  email?: string | null;
  address?: string | null;
  settlementMethodId?: string | null;
  paymentMethodId?: string | null;
  defaultTransportMethodCode?: string | null;
  defaultTransportMethodName?: string | null;
  transportSurcharge?: string | null;
  pricingPolicy: DclCustomerPricingPolicy;
  creditLimits: Array<DclCustomerCreditLimit>;
  primarySalesAttribution: DclCustomerSalesAttributionInput;
  internalReminder?: string | null;
  defaultSalesOrderRemark?: string | null;
};
