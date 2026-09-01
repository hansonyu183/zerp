/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DclCustomerAttachmentView } from './DclCustomerAttachmentView';
import type { DclCustomerAuxiliarySnapshot } from './DclCustomerAuxiliarySnapshot';
import type { DclCustomerCreditLimit } from './DclCustomerCreditLimit';
import type { DclCustomerPricingPolicy } from './DclCustomerPricingPolicy';
import type { DclCustomerSalesAttributionSnapshot } from './DclCustomerSalesAttributionSnapshot';
export type DclCustomerAccountData = {
  accountId: string;
  code: string;
  enabled: boolean;
  isDefault: boolean;
  name: string;
  shortName?: string | null;
  customerTypeId: string;
  customerType: DclCustomerAuxiliarySnapshot;
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
  settlementMethod: DclCustomerAuxiliarySnapshot | null;
  paymentMethod: DclCustomerAuxiliarySnapshot | null;
  primarySalesAttribution: DclCustomerSalesAttributionSnapshot;
  internalReminder?: string | null;
  defaultSalesOrderRemark?: string | null;
  attachments: Array<DclCustomerAttachmentView>;
};
