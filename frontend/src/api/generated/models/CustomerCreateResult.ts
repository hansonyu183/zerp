/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BobMutationResult } from './BobMutationResult';
import type { CustomerAccountView } from './CustomerAccountView';
export type CustomerCreateResult = (BobMutationResult & {
  partyId: string;
  defaultAccount: CustomerAccountView;
});
