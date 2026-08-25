/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AuxEntity } from './AuxEntity';
import type { AuxVersionView } from './AuxVersionView';
export type AuxObjectView = {
  objectId: string;
  entity: AuxEntity;
  code: string;
  enabled: boolean;
  objectRevision: number;
  currentVersion: AuxVersionView;
  updatedAt: string;
  updatedBy: string;
};

