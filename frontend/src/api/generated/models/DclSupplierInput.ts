/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BusinessIdentityKind } from './BusinessIdentityKind';
export type DclSupplierInput = {
  kind: BusinessIdentityKind;
  legalName: string;
  displayName?: string;
  legalIdentifier: string;
  enabled: boolean;
  operatingEntityIds: Array<string>;
  defaultOperatingEntityId: string;
  shortName?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  email?: string | null;
  address?: string | null;
  remark?: string | null;
  settlementMethodId?: string | null;
  defaultPurchaserEmployeeId?: string | null;
};
