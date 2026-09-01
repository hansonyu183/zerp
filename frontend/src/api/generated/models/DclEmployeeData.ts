/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DclBusinessArchiveSnapshot } from './DclBusinessArchiveSnapshot';
import type { DclEmployeeInput } from './DclEmployeeInput';
export type DclEmployeeData = (DclEmployeeInput & {
  currentOperatingEntity: DclBusinessArchiveSnapshot;
  employeeCategoryId?: string | null;
  employeeCategoryCode?: string | null;
  employeeCategoryName?: string | null;
  departmentId?: string | null;
  departmentCode?: string | null;
  departmentName?: string | null;
  positionId?: string | null;
  positionCode?: string | null;
  positionName?: string | null;
  phone?: string | null;
  email?: string | null;
  hireDate?: string | null;
  remark?: string | null;
});
