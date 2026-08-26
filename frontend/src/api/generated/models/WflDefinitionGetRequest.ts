/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type WflDefinitionGetRequest = {
  definitionId: string;
  /**
   * 精确读取该 Approval Version；省略时读取 latest APPROVED 或开放候选。
   */
  approvalEntryId?: string;
};
