/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type BobVersionSummary = {
  versionId: string;
  version: number;
  status: 'DRAFT' | 'PENDING' | 'REJECTED' | 'EFFECTIVE' | 'INVALID';
  revision: number;
  submittedBy: string | null;
  summary: Record<string, any>;
};
