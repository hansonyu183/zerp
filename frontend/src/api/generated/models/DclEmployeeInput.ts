/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BusinessIdentifier } from './BusinessIdentifier';
import type { BusinessIdentityKind } from './BusinessIdentityKind';
export type DclEmployeeInput = {
  kind: BusinessIdentityKind;
  legalName: string;
  displayName?: string;
  taxNumber?: string;
  strongIdentifiers: Array<BusinessIdentifier>;
  enabled: boolean;
  currentOperatingEntityId: string;
  employeeCategoryId?: string | null;
  departmentId?: string | null;
  positionId?: string | null;
  phone?: string | null;
  email?: string | null;
  hireDate?: string | null;
  remark?: string | null;
};
