/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { MappingCondition } from './MappingCondition';
import type { MappingResult } from './MappingResult';
export type MappingRule = {
  conditions: Array<MappingCondition>;
  result: MappingResult;
  templateId: string | null;
};
