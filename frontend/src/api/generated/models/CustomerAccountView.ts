/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CustomerVersionView } from './CustomerVersionView';
export type CustomerAccountView = {
  objectId: string;
  code: string;
  objectRevision: number;
  enabled: boolean;
  /**
   * DCL current 投影的精确来源 Approval Entry；employee 必须返回该值。
   */
  sourceApprovalEntryId?: string | null;
  latestApproved?: CustomerVersionView | null;
  openVersion?: CustomerVersionView | null;
};
