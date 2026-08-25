/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type CustomerVersionMeta = {
  versionId: string;
  version: number;
  status: 'DRAFT' | 'PENDING' | 'EFFECTIVE' | 'INVALID';
  revision: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  submittedAt: string | null;
  submittedBy: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewComment: string | null;
};
