/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SalesPartnerCapability } from './SalesPartnerCapability';
export type SalesPartnerListVersion = {
  versionId: string;
  version: number;
  status: 'DRAFT' | 'PENDING' | 'EFFECTIVE' | 'INVALID';
  revision: number;
  capabilities: Array<SalesPartnerCapability>;
  submittedBy: string | null;
};
