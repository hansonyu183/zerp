/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalVersionMeta } from './ApprovalVersionMeta';
import type { WflDefinitionDiagnostic } from './WflDefinitionDiagnostic';
import type { WflDefinitionEdge } from './WflDefinitionEdge';
import type { WflDefinitionNode } from './WflDefinitionNode';
export type DclWflProcessDefinitionVersionView = {
  script: string;
  diagnostic?: WflDefinitionDiagnostic;
  approval: ApprovalVersionMeta;
  nodes: Array<WflDefinitionNode>;
  edges: Array<WflDefinitionEdge>;
};
