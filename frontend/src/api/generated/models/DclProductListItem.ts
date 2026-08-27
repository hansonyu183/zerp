/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DclProductVersionView } from './DclProductVersionView';
export type DclProductListItem = {
  objectId: string;
  entity: 'product';
  code: string;
  objectRevision: number;
  enabled: boolean;
  latestApproved: DclProductVersionView | null;
  openVersion: DclProductVersionView | null;
  updatedAt: string;
};
