/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { RoleType } from './RoleType';
import type { UserStatus } from './UserStatus';
export type UserRoleSummary = {
  id: string;
  code: string;
  name: string;
  status: UserStatus;
  type: RoleType;
  assignable: boolean;
};
