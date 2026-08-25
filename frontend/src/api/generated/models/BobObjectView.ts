/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BobDetailView } from './BobDetailView';
import type { BobEntity } from './BobEntity';
import type { BobRelationshipIdentityView } from './BobRelationshipIdentityView';
import type { BobVersionMeta } from './BobVersionMeta';
export type BobObjectView = {
  objectId: string;
  entity: BobEntity;
  code: string;
  objectRevision: number;
  enabled: boolean;
  currentVersionId: string;
  effectiveVersionId: string | null;
  updatedAt: string;
  version: BobVersionMeta;
  data: BobDetailView;
  relationship?: BobRelationshipIdentityView;
};
