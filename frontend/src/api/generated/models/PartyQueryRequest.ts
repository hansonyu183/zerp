/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { PartyKind } from './PartyKind';
export type PartyQueryRequest = {
  page: number;
  pageSize: 20;
  filters?: {
    keyword?: string;
    kind?: PartyKind;
  };
};
