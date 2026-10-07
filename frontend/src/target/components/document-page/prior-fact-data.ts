import {
  vouPriorSourceDocumentPresentation,
  type VouPriorFact,
} from '@zerp/model'
import type { FormFields } from '../dynamic-fields/form-fields.ts'
export const priorFactFields = [
  {
    key: 'sourceInstanceId',
    type: 'text',
    caption: '来源实例',
    required: true,
  },
  { key: 'sourceSchema', type: 'text', caption: '来源库', required: true },
  {
    key: 'sourceDocumentType',
    type: 'enum',
    caption: '来源类型',
    required: true,
    options: Object.entries(vouPriorSourceDocumentPresentation).map(
      ([value, item]) => ({ value, caption: item.label }),
    ),
  },
  {
    key: 'sourceDocumentKey',
    type: 'text',
    caption: '原单据键',
    required: true,
  },
  { key: 'sourceDocumentNo', type: 'text', caption: '原单号', required: true },
  { key: 'capturedAt', type: 'text', caption: '封存截止时间', required: true },
  {
    key: 'snapshotDigest',
    type: 'text',
    caption: '来源快照摘要',
    required: true,
  },
] as const satisfies FormFields<VouPriorFact>
