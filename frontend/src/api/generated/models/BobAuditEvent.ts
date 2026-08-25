/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BobEntity } from './BobEntity';
export type BobAuditEvent = {
  id: string;
  objectId: string;
  versionId: string;
  entity: BobEntity;
  eventType: string;
  fromStatus: 'DRAFT' | 'PENDING' | 'REJECTED' | 'EFFECTIVE' | 'INVALID' | null;
  toStatus: 'DRAFT' | 'PENDING' | 'REJECTED' | 'EFFECTIVE' | 'INVALID';
  actorId: string;
  occurredAt: string;
  comment: string | null;
  requestId: string;
  summary: Record<string, any>;
};

