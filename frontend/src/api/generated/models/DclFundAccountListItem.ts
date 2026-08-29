/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DclFundAccountVersionView } from './DclFundAccountVersionView';
export type DclFundAccountListItem = {
  objectId: string;
  entity: 'fund-account';
  code: string;
  enabled: boolean;
  latestApproved: DclFundAccountVersionView | null;
  openVersion: DclFundAccountVersionView | null;
  updatedAt: string;
};
