import { vouEntities, vouEntityPresentation, type VouEntity } from './vou.ts'

export function workflowCreateAction(entity: VouEntity): string {
  return `create-${entity}`
}
export function workflowCreatePermission(entity: VouEntity): string {
  return `/wfl/process-instance/${workflowCreateAction(entity)}`
}
export const workflowCreatePermissionLabels: Readonly<Record<string, string>> =
  Object.fromEntries(
    vouEntities.map((entity) => [
      workflowCreateAction(entity),
      `创建${vouEntityPresentation[entity].label}`,
    ]),
  )
