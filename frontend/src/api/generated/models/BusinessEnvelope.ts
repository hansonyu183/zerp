/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type BusinessEnvelope = {
  code: number;
  /**
   * 稳定业务错误语义；成功时为空字符串。前端按此字段映射提示或选择业务分支。
   */
  errorKey: string;
  /**
   * 用于诊断和未知 errorKey 的默认可读说明。前端不得比较、匹配或推断此字段；内部失败不得包含 SQL、调用栈、内部组件名或原始异常。
   */
  message: string;
  data: Record<string, any> | null;
  requestId: string;
};
