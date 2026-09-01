/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BusinessIdentifier } from './BusinessIdentifier';
import type { BusinessIdentityKind } from './BusinessIdentityKind';
export type DclOtherUnitInput = {
  kind: BusinessIdentityKind;
  legalName: string;
  displayName?: string;
  taxNumber?: string;
  strongIdentifiers: Array<BusinessIdentifier>;
  enabled: boolean;
  operatingEntityIds: Array<string>;
  defaultOperatingEntityId: string;
  contactName?: string | null;
  contactPhone?: string | null;
  email?: string | null;
  address?: string | null;
  settlementMethodId?: string | null;
  remark?: string | null;
};
