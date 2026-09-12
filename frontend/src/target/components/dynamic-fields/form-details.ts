import type { FormField } from './form-fields.ts'
import type { DetailField } from '../details/detail-fields.ts'
export function formDetails(
  fields: readonly FormField[],
): readonly DetailField[] {
  return fields.map((field) => {
    if (field.type === 'rows')
      return {
        key: field.key,
        caption: field.caption,
        type: 'rows',
        fields: formDetails(field.fields),
      }
    if (field.type === 'snapshot-reference')
      return {
        key: field.key,
        caption: field.caption,
        type: 'group',
        fields: [
          { key: 'code', caption: '编码', type: 'text' },
          { key: 'name', caption: '名称', type: 'text' },
        ],
      }
    return field
  })
}
