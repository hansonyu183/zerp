/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CustomerIdentityKind } from './CustomerIdentityKind';
import type { DclCustomerAccountData } from './DclCustomerAccountData';
import type { DclCustomerRemittanceProfile } from './DclCustomerRemittanceProfile';
import type { DclCustomerSnapshot } from './DclCustomerSnapshot';
export type DclCustomerData = {
  kind: CustomerIdentityKind;
  legalName: string;
  displayName: string;
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
  defaultOperatingEntity: DclCustomerSnapshot;
  enabled: boolean;
  accounts: Array<DclCustomerAccountData>;
};
