/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalVersionMeta } from './ApprovalVersionMeta';
import type { WflDefinitionDiagnostic } from './WflDefinitionDiagnostic';
import type { WflDefinitionEdge } from './WflDefinitionEdge';
import type { WflDefinitionNode } from './WflDefinitionNode';
export type DclWflProcessDefinitionView = {
  code: string;
  definitionId: string;
  enabled: boolean;
  revision: number;
  approval: ApprovalVersionMeta;
  script: string;
  diagnostic?: WflDefinitionDiagnostic;
  nodes: Array<WflDefinitionNode>;
  edges: Array<WflDefinitionEdge>;
};
