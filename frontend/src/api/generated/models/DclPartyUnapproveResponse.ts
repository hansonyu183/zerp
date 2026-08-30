/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DclPartyMutation } from './DclPartyMutation';
import type { DclPartyUnapproveBlockers } from './DclPartyUnapproveBlockers';
export type DclPartyUnapproveResponse = {
  code: number;
  errorKey: string;
  message: string;
  data: (DclPartyMutation | DclPartyUnapproveBlockers) | null;
  requestId: string;
};
