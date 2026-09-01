/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BobDetailView } from './BobDetailView';
import type { BobEntity } from './BobEntity';
export type BobListItem = {
  objectId: string;
  entity: BobEntity;
  code: string;
  enabled: boolean;
  sourceApprovalEntryId: string;
  sourceVersionNo: number;
  data: BobDetailView;
  updatedAt: string;
};
