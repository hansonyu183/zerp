/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type SalesPartnerMutationResult = {
  objectId: string;
  objectRevision: number;
  enabled: boolean;
  versionId: string;
  version: number;
  status: 'DRAFT' | 'PENDING' | 'EFFECTIVE' | 'INVALID';
  revision: number;
  partyId?: string;
};
