/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { UserStatus } from './UserStatus';
export type RolePermission = {
  id: string;
  path: string;
  description: string | null;
  status: UserStatus;
  domain: string;
  entity: string;
  action: string;
};
