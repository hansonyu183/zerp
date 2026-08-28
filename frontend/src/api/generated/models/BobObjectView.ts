/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BobDetailView } from './BobDetailView';
import type { BobEntity } from './BobEntity';
import type { BobRelationshipIdentityView } from './BobRelationshipIdentityView';
export type BobObjectView = {
  objectId: string;
  entity: BobEntity;
  code: string;
  objectRevision: number;
  enabled: boolean;
  /**
   * DCL current 投影的精确来源 Approval Entry。
   */
  sourceApprovalEntryId: string;
  sourceVersionNo: number;
  updatedAt: string;
  data: BobDetailView;
  relationship?: BobRelationshipIdentityView;
};
