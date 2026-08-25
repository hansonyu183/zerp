/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CustomerCreditLimit } from './CustomerCreditLimit';
import type { CustomerPricingPolicy } from './CustomerPricingPolicy';
import type { CustomerSalesAttributionView } from './CustomerSalesAttributionView';
import type { CustomerSnapshot } from './CustomerSnapshot';
export type CustomerAccountDataView = {
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
  operatingEntity: CustomerSnapshot | null;
  settlementMethod: CustomerSnapshot | null;
  paymentMethod: CustomerSnapshot | null;
  primarySalesAttribution: CustomerSalesAttributionView;
  internalReminder?: string | null;
  defaultSalesOrderRemark?: string | null;
};
