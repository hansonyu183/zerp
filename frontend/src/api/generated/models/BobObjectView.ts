/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BobDetailView } from './BobDetailView';
import type { BobEntity } from './BobEntity';
export type BobObjectView = {
  objectId: string;
  entity: BobEntity;
  code: string;
  enabled: boolean;
  /**
   * 当前有效只读资料的精确来源 Approval Entry。
   */
  sourceApprovalEntryId: string;
  sourceVersionNo: number;
  updatedAt: string;
  data: BobDetailView;
};
