/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CustomerIdentityKind } from './CustomerIdentityKind';
import type { DclCustomerRemittanceProfile } from './DclCustomerRemittanceProfile';
export type DclCustomerRootInput = {
  kind: CustomerIdentityKind;
  legalName: string;
  displayName?: string | null;
  legalIdentifier: string | null;
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
};
