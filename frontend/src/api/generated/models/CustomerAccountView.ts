/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CustomerVersionView } from './CustomerVersionView';
export type CustomerAccountView = {
  objectId: string;
  code: string;
  objectRevision: number;
  enabled: boolean;
  effective?: CustomerVersionView | null;
  candidate?: CustomerVersionView | null;
};
