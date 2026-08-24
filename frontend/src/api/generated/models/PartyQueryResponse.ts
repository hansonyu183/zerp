/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { PartyListItem } from './PartyListItem';
export type PartyQueryResponse = {
  code: number;
  errorKey: string;
  message: string;
  data: {
    items: Array<PartyListItem>;
    total: number;
    page: number;
    pageSize: number;
  } | null;
  requestId: string;
};

