/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { UserStatus } from './UserStatus';
export type UserListItem = {
  id: string;
  username: string;
  displayName: string;
  status: UserStatus;
  system: boolean;
  createdAt: string;
  updatedAt: string;
  revision: number;
  manageable: boolean;
};
