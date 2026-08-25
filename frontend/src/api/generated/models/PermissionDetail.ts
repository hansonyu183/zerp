/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { UserStatus } from './UserStatus';
export type PermissionDetail = {
  path: string;
  domain: string;
  entity: string;
  action: string;
  description: string | null;
  status: UserStatus;
  roleCount: number;
};
