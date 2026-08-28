/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DclWflProcessDefinitionVersionSummary } from './DclWflProcessDefinitionVersionSummary';
export type DclWflProcessDefinitionListItem = {
  code: string;
  definitionId: string;
  enabled: boolean;
  revision: number;
  latestApproved: DclWflProcessDefinitionVersionSummary | null;
  openVersion: DclWflProcessDefinitionVersionSummary | null;
};
