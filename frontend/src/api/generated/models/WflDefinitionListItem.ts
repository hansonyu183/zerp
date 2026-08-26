/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalVersionMeta } from './ApprovalVersionMeta';
import type { VouEntity } from './VouEntity';
export type WflDefinitionListItem = {
  definitionId: string;
  code: string;
  name: string;
  enabled: boolean;
  /**
   * stable definition revision; only enable/disable use it.
   */
  revision: number;
  approval: ApprovalVersionMeta;
  rootEntity: VouEntity;
  nodeCount: number;
  updatedAt: string;
};
