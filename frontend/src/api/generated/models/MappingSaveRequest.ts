/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { MappingDefinition } from './MappingDefinition';
import type { MappingResult } from './MappingResult';
export type MappingSaveRequest = {
  bookId: string;
  vouEntity: string;
  approvalEntryId: string;
  defaultResult: MappingResult;
  definition: MappingDefinition;
  revision: number;
};
