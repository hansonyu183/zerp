/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalVersionMeta } from './ApprovalVersionMeta';
export type CustomerListItem = {
  objectId: string;
  code: string;
  objectRevision: number;
  enabled: boolean;
  latestApproved: {
    approval: ApprovalVersionMeta;
    name?: string;
    customerTypeCode?: string;
    operatingEntityName?: string;
    salesAttributionName?: string;
  } | null;
  openVersion: {
    approval: ApprovalVersionMeta;
    name?: string;
    customerTypeCode?: string;
  } | null;
  updatedAt: string;
};
