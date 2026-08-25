/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApprovalStatus } from './ApprovalStatus';
export type ApprovalVersionMeta = {
  /**
   * 中央 Approval entry 的稳定身份。
   */
  approvalEntryId: string;
  /**
   * 同一 stable subject 内从 1 开始的版本号。
   */
  versionNo: number;
  status: ApprovalStatus;
  revision: number;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  submittedBy: string | null;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
};

