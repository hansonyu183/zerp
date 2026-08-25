/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SessionUser } from './SessionUser';
export type SessionData = {
  user: SessionUser;
  csrfToken: string;
  permissions: Array<string>;
  passwordChangeRequired: boolean;
  passwordMinLength: number;
};
