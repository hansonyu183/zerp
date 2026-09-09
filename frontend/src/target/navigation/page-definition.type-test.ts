import type { ConfigurationDefinition } from '../components/configuration-page/definition.ts'
import type { ReportDefinition } from '../components/report-page/definition.ts'
import type { ProcessDefinition } from '../components/process-page/definition.ts'
const wrongResource: ConfigurationDefinition = {
  kind: 'configuration',
  // @ts-expect-error A configuration definition cannot select a report resource.
  resource: 'rpt/rpt-000001',
}
const runtime: ProcessDefinition = {
  kind: 'process',
  resource: 'wfl/process-instance',
  // @ts-expect-error Business definitions cannot inject page state.
  vm: {},
}
const callback: ReportDefinition = {
  kind: 'report',
  code: 'rpt-000001',
  // @ts-expect-error Reports consume their fixed typed API, not arbitrary callbacks.
  query: async () => [],
}
const invalidCode: ReportDefinition = {
  kind: 'report',
  // @ts-expect-error Report identity is separate from voucher or archive identity.
  code: 'sale-order',
}
void [wrongResource, runtime, callback, invalidCode]
