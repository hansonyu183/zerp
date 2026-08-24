/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SystemParameterConstraints } from './SystemParameterConstraints';
import type { SystemParameterValueType } from './SystemParameterValueType';
export type SystemParameterView = {
  key: string;
  name: string;
  description: string | null;
  valueType: SystemParameterValueType;
  configuredValue: string;
  defaultValue: string;
  editable: boolean;
  constraints: SystemParameterConstraints | null;
  revision: number;
};

