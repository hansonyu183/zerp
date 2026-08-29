/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DclRptDefinitionVersionSummary } from './DclRptDefinitionVersionSummary';
export type DclRptDefinitionListItem = {
  code: string;
  definitionId: string;
  name: string;
  description: string;
  enabled: boolean;
  latestApproved: DclRptDefinitionVersionSummary | null;
  openVersion: DclRptDefinitionVersionSummary | null;
};
