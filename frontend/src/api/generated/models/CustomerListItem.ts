/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type CustomerListItem = {
  objectId: string;
  code: string;
  objectRevision: number;
  enabled: boolean;
  latestApproved: {
    approvalEntryId?: string;
    version?: number;
    status?: string;
    revision?: number;
    name?: string;
    customerTypeCode?: string;
    operatingEntityName?: string;
    salesAttributionName?: string;
    submittedBy?: string | null;
  } | null;
  openVersion: {
    approvalEntryId?: string;
    version?: number;
    status?: string;
    revision?: number;
    name?: string;
    customerTypeCode?: string;
    submittedBy?: string | null;
  } | null;
  updatedAt: string;
};
