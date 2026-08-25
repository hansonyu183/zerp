/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { WflBusinessObjectReference } from './WflBusinessObjectReference';
export type WflExecutionTrace = {
  sourceNodeKey: string;
  targetNodeKey: string;
  relation: string;
  action: string;
  result: WflBusinessObjectReference;
};
