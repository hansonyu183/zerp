/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { PartyKind } from './PartyKind';
export type DclPartyQueryRequest = {
  page: number;
  pageSize: 20;
  filters?: {
    keyword?: string;
    kind?: PartyKind;
    /**
     * 省略或 false 查询当前可用主体；true 查询已合并声明审计主体。
     */
    merged?: boolean;
  };
};
