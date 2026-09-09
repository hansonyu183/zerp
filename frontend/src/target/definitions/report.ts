import type { ReportDefinition } from '../components/report-page/definition.ts'
export function reportPage(code: ReportDefinition['code']): ReportDefinition {
  return { kind: 'report', code }
}
