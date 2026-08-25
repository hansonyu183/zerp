/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { UserRoleSummary } from './UserRoleSummary';
import type { UserStatus } from './UserStatus';
export type UserDetail = {
  id: string;
  username: string;
  displayName: string;
  status: UserStatus;
  system: boolean;
  createdAt: string;
  updatedAt: string;
  revision: number;
  passwordChangedAt: string;
  roles: Array<UserRoleSummary>;
  manageable: boolean;
  roleAssignmentEditable: boolean;
};
