/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { RptParameterType } from './RptParameterType';
import type { RptReferenceType } from './RptReferenceType';
export type RptParameter = {
  key: string;
  name: string;
  type: RptParameterType;
  required: boolean;
  defaultValue?: any;
  enumValues?: Array<string>;
  referenceType?: RptReferenceType;
};
