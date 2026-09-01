/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BusinessIdentifier } from './BusinessIdentifier';
import type { BusinessIdentityKind } from './BusinessIdentityKind';
import type { DclCustomerAccountInput } from './DclCustomerAccountInput';
import type { DclCustomerRemittanceProfile } from './DclCustomerRemittanceProfile';
export type DclCustomerInput = {
  kind: BusinessIdentityKind;
  legalName: string;
  displayName?: string | null;
  taxNumber?: string | null;
  strongIdentifiers: Array<BusinessIdentifier>;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  invoiceTitle?: string | null;
  invoiceAddress?: string | null;
  invoicePhone?: string | null;
  invoiceBankName?: string | null;
  invoiceBankAccount?: string | null;
  remittanceProfiles: Array<DclCustomerRemittanceProfile>;
  defaultOperatingEntityId: string;
  enabled: boolean;
  accounts: Array<DclCustomerAccountInput>;
};
