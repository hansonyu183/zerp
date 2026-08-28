/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BobDetailView } from './BobDetailView';
import type { BobEntity } from './BobEntity';
import type { BobRelationshipIdentityView } from './BobRelationshipIdentityView';
export type BobListItem = {
  objectId: string;
  entity: BobEntity;
  code: string;
  objectRevision: number;
  enabled: boolean;
  sourceApprovalEntryId: string;
  sourceVersionNo: number;
  data: BobDetailView;
  relationship?: BobRelationshipIdentityView;
  updatedAt: string;
};
