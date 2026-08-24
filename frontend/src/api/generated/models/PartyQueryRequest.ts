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
    /**
     * 省略或 false 仅查询可用主体；true 仅查询已合并审计主体。
     */
    merged?: boolean;
  };
};

