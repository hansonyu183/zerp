/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { MappingDefinition } from './MappingDefinition';
import type { MappingResult } from './MappingResult';
import type { MappingState } from './MappingState';
export type Mapping = {
  mappingId: string;
  bookId: string;
  vouEntity: string;
  version: number;
  state: MappingState;
  defaultResult: MappingResult;
  definition: MappingDefinition;
  revision: number;
  approvedAt: string | null;
  approvedBy: string | null;
};

