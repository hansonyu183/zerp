/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ProductBehaviorProfile } from './ProductBehaviorProfile';
export type AuxQueryRequest = {
  page: number;
  pageSize: number;
  filters?: {
    keyword?: string;
    enabled?: boolean;
    behaviorProfile?: ProductBehaviorProfile;
    parentId?: string;
    rootOnly?: boolean;
    dictionaryTypeCode?: string;
    direction?: 'INCOME' | 'EXPENSE';
  };
  sort?: Array<{
    field: 'updatedAt' | 'code' | 'name' | 'version';
    order: 'asc' | 'desc';
  }>;
};

