import type { ApprovalStatus } from '@/api/generated'
import type { BusinessObjectField } from '@/components/business-object'
import { maxLength } from '@/pages/dcl/shared/bob-config-helpers'
import {
  approvalStatusOptions,
  approvalStatusPresentation,
} from '@/shared/approval'
import {
  dclTypedArchiveActiveVersion,
  type DclTypedArchiveConfig,
  type DclTypedArchiveEntity,
  type DclTypedArchiveForm,
} from './types'
const fields: readonly BusinessObjectField<DclTypedArchiveForm>[] = [
  { key: 'code', label: '编码', type: 'readonly' },
  {
    key: 'kind',
    label: '身份类型',
    type: 'select',
    required: true,
    options: [
      { title: '个人', value: 'PERSON' },
      { title: '组织', value: 'ORGANIZATION' },
    ],
  },
  {
    key: 'legalName',
    label: '法定名称',
    type: 'text',
    required: true,
    rules: [maxLength('法定名称', 200)],
  },
  { key: 'displayName', label: '显示名称', type: 'text' },
  {
    key: 'legalIdentifier',
    label: '法定识别号',
    type: 'text',
    rules: [maxLength('法定识别号', 100)],
  },
  {
    key: 'operatingEntityIds',
    label: '适用经营主体',
    type: 'autocomplete',
    multiple: true,
    required: true,
  },
  {
    key: 'defaultOperatingEntityId',
    label: '默认经营主体',
    type: 'autocomplete',
    required: true,
  },
  { key: 'contactName', label: '联系人', type: 'text' },
  { key: 'contactPhone', label: '联系电话', type: 'text' },
  { key: 'email', label: '邮箱', type: 'text' },
  { key: 'address', label: '地址', type: 'textarea', span: 2 },
  { key: 'enabled', label: '启用', type: 'switch' },
]
export function dclTypedArchiveConfig(
  entity: DclTypedArchiveEntity,
): DclTypedArchiveConfig {
  return {
    fields: [
      ...fields,
      ...(entity === 'other-unit'
        ? [
            {
              key: 'settlementMethodId',
              label: '结算方式',
              type: 'autocomplete',
            } satisfies BusinessObjectField<DclTypedArchiveForm>,
          ]
        : [
            {
              key: 'capabilities',
              label: '能力',
              type: 'select',
              multiple: true,
              options: [
                { title: '外部兼职销售', value: 'EXTERNAL_PART_TIME' },
                { title: '渠道商', value: 'CHANNEL_PARTNER' },
              ],
            } satisfies BusinessObjectField<DclTypedArchiveForm>,
          ]),
      {
        key: 'remark',
        label: '备注',
        type: 'textarea',
        span: 2,
        rules: [maxLength('备注', 1000)],
      },
    ],
    emptyForm: () => ({
      code: '',
      kind: 'ORGANIZATION',
      legalName: '',
      displayName: '',
      legalIdentifier: '',
      enabled: true,
      operatingEntityIds: [],
      defaultOperatingEntityId: '',
      contactName: '',
      contactPhone: '',
      email: '',
      address: '',
      settlementMethodId: '',
      capabilities: [],
      remark: '',
    }),
    columns: [
      {
        key: 'code',
        label: '编码',
        value: (row) => row.code,
        sizing: 'compact',
      },
      {
        key: 'name',
        label: '名称',
        value: (row) => row.displayName,
        sizing: 'fluid',
      },
      {
        key: 'operatingEntity',
        label: '默认经营主体',
        value: (row) =>
          `${row.defaultOperatingEntity.code} · ${row.defaultOperatingEntity.name}`,
      },
      {
        key: 'status',
        label: '状态',
        value: (row) => dclTypedArchiveActiveVersion(row).approval.status,
        format: (value) =>
          approvalStatusPresentation[value as ApprovalStatus].label,
        sizing: 'compact',
      },
    ],
    filters: [
      {
        key: 'status',
        label: '状态',
        type: 'select',
        multiple: true,
        options: approvalStatusOptions,
      },
      {
        key: 'enabled',
        label: '启停状态',
        type: 'select',
        options: [
          { title: '启用', value: true },
          { title: '禁用', value: false },
        ],
      },
    ],
  }
}
