import type { DclWflProcessDefinitionListItem } from './api'

export function activeDclWflProcessDefinitionVersion(
  row: DclWflProcessDefinitionListItem,
) {
  return row.openVersion ?? row.latestApproved
}
