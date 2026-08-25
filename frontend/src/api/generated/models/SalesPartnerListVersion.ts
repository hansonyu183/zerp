/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SalesPartnerCapability } from './SalesPartnerCapability';
export type SalesPartnerListVersion = {
  approvalEntryId: string;
  version: number;
  status: 'DRAFT' | 'PENDING' | 'APPROVED';
  revision: number;
  capabilities: Array<SalesPartnerCapability>;
  submittedBy: string | null;
};
