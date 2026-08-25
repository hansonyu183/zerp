/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { UserStatus } from './UserStatus';
export type PermissionView = {
  id: string;
  path: string;
  domain: string;
  entity: string;
  action: string;
  description: string | null;
  status: UserStatus;
  revision: number;
  assignable: boolean;
  roleCount?: number | null;
};
