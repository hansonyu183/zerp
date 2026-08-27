/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BobActiveReferenceBlockers } from './BobActiveReferenceBlockers';
import type { BobMutationResult } from './BobMutationResult';
export type BobDisableResponse = {
  code: number;
  errorKey: string;
  message: string;
  data: (BobActiveReferenceBlockers | BobMutationResult) | null;
  requestId: string;
};
