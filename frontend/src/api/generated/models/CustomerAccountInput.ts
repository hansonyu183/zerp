/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CustomerCreditLimit } from './CustomerCreditLimit';
import type { CustomerPricingPolicy } from './CustomerPricingPolicy';
import type { CustomerSalesAttributionInput } from './CustomerSalesAttributionInput';
export type CustomerAccountInput = {
  name: string;
  shortName?: string | null;
  customerTypeCode: string;
  contactName?: string | null;
  contactPhone?: string | null;
  email?: string | null;
  address?: string | null;
  operatingEntityId: string;
  settlementMethodId?: string | null;
  paymentMethodId?: string | null;
  defaultTransportMethodCode?: string | null;
  defaultTransportMethodName?: string | null;
  transportSurcharge?: string | null;
  pricingPolicy: CustomerPricingPolicy;
  creditLimits: Array<CustomerCreditLimit>;
  primarySalesAttribution: CustomerSalesAttributionInput;
  internalReminder?: string | null;
  defaultSalesOrderRemark?: string | null;
};

