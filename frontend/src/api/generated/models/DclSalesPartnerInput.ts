/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BusinessIdentityKind } from './BusinessIdentityKind';
import type { SalesPartnerCapability } from './SalesPartnerCapability';
export type DclSalesPartnerInput = {
  kind: BusinessIdentityKind;
  legalName: string;
  displayName?: string;
  legalIdentifier: string;
  enabled: boolean;
  operatingEntityIds: Array<string>;
  defaultOperatingEntityId: string;
  capabilities?: Array<SalesPartnerCapability>;
  contactName?: string | null;
  contactPhone?: string | null;
  email?: string | null;
  address?: string | null;
  remark?: string | null;
};
