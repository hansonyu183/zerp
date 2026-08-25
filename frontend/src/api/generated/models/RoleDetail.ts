/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { RoleAction } from './RoleAction';
import type { RolePermission } from './RolePermission';
import type { RoleType } from './RoleType';
import type { UserStatus } from './UserStatus';
export type RoleDetail = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: UserStatus;
  type: RoleType;
  availableActions: Array<RoleAction>;
  assignable: boolean;
  createdAt: string;
  updatedAt: string;
  revision: number;
  permissions: Array<RolePermission>;
};
