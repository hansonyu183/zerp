import type { RptDefinitionListItem } from './api'

export const rptDefinitionValidityPresentation = {
  VALID: { label: '有效', color: 'success' },
  INVALID: { label: '失效', color: 'error' },
} as const

export function activeRptDefinitionVersion(row: RptDefinitionListItem) {
  return row.openVersion ?? row.latestApproved
}
