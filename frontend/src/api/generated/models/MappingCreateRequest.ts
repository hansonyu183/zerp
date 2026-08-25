/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { MappingDefinition } from './MappingDefinition';
import type { MappingResult } from './MappingResult';
export type MappingCreateRequest = {
  bookId: string;
  vouEntity: string;
  defaultResult: MappingResult;
  definition: MappingDefinition;
};
