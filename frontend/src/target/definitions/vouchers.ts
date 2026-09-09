import { vouTypes } from '@zerp/model'
import type { DocumentDefinition } from '../components/document-page/definition.ts'
export const voucherDefinitions = Object.fromEntries(
  vouTypes.map((vouType) => [
    vouType,
    { kind: 'document', vouType } satisfies DocumentDefinition,
  ]),
) as Record<(typeof vouTypes)[number], DocumentDefinition>
