/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalVersionMeta } from './ApprovalVersionMeta';
import type { DclFundAccountData } from './DclFundAccountData';
export type DclFundAccountView = {
  objectId: string;
  entity: 'fund-account';
  code: string;
  enabled: boolean;
  approval: ApprovalVersionMeta;
  data: DclFundAccountData;
  updatedAt: string;
};
