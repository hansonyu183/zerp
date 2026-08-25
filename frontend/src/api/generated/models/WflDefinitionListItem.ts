/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { VouEntity } from './VouEntity';
import type { WflDefinitionStatus } from './WflDefinitionStatus';
export type WflDefinitionListItem = {
  definitionId: string;
  code: string;
  name: string;
  status: WflDefinitionStatus;
  revision: number;
  publishedRevision?: number;
  rootEntity: VouEntity;
  nodeCount: number;
  updatedAt: string;
};
