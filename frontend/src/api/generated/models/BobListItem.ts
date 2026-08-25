/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BobEntity } from './BobEntity';
import type { BobVersionSummary } from './BobVersionSummary';
export type BobListItem = {
  objectId: string;
  entity: BobEntity;
  code: string;
  objectRevision: number;
  enabled: boolean;
  effective: BobVersionSummary | null;
  candidate: BobVersionSummary | null;
  updatedAt: string;
};
