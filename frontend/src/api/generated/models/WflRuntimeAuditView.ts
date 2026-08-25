/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type WflRuntimeAuditView = {
  id: string;
  eventType: string;
  nodeInstanceId?: string | null;
  documentId?: string | null;
  documentNo?: string | null;
  actorId: string;
  requestId: string;
  summary: Record<string, any>;
  occurredAt: string;
};
