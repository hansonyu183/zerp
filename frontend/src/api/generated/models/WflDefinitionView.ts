/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { VouEntity } from './VouEntity';
import type { WflDefinitionDiagnostic } from './WflDefinitionDiagnostic';
import type { WflDefinitionEdge } from './WflDefinitionEdge';
import type { WflDefinitionNode } from './WflDefinitionNode';
import type { WflDefinitionStatus } from './WflDefinitionStatus';
export type WflDefinitionView = {
  definitionId: string;
  code: string;
  name: string;
  status: WflDefinitionStatus;
  revision: number;
  publishedRevision?: number;
  rootEntity: VouEntity;
  nodeCount: number;
  updatedAt: string;
  script: string;
  diagnostic?: WflDefinitionDiagnostic;
  rootNodeKey: string;
  nodes: Array<WflDefinitionNode>;
  edges: Array<WflDefinitionEdge>;
};
