/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { VouEntity } from './VouEntity';
export type WflDefinitionTrialRequest = {
  definitionId: string;
  revision: number;
  source: {
    entity: VouEntity;
    documentId: string;
  };
};

