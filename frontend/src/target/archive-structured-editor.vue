<script setup lang="ts">
import { computed } from 'vue'

import type { AnyArchiveDraft } from './archive-drafts.ts'
import {
  archiveWirePresentation,
  type ArchiveField,
} from './archive-presentation.ts'
import ArchiveReferenceEditor from './archive-reference-editor.vue'
import { createTargetId } from './warehouse-drafts.ts'

const props = withDefaults(
  defineProps<{
    draft: AnyArchiveDraft
    fields: readonly ArchiveField[]
    referenceOptions: Readonly<
      Record<string, readonly Record<string, unknown>[]>
    >
  }>(),
  {
    fields: () => [],
    referenceOptions: () => ({}),
  },
)
const emit = defineEmits<{
  save: [draft: AnyArchiveDraft]
  addCustomerSubunitAttachment: [
    draft: AnyArchiveDraft,
    subunitId: string,
    file: File,
  ]
}>()

type Path = readonly (string | number)[]
type EditableRecord = Record<string, unknown>

const snapshot = computed(
  () => props.draft.snapshot as unknown as EditableRecord,
)

const labels = archiveWirePresentation

function productBehaviorLabel(value: unknown): string {
  return typeof value === 'string' && value in labels.productBehavior
    ? labels.productBehavior[value as keyof typeof labels.productBehavior]
    : '未识别产品行为'
}

function recordAt(path: Path): EditableRecord {
  let value: unknown = snapshot.value
  for (const key of path) value = containerValue(value, key)
  return isRecord(value) ? value : {}
}

function recordsAt(path: Path): EditableRecord[] {
  let value: unknown = snapshot.value
  for (const key of path) value = containerValue(value, key)
  return Array.isArray(value) ? (value as EditableRecord[]) : []
}

function valueAt(path: Path): unknown {
  let value: unknown = snapshot.value
  for (const key of path) value = containerValue(value, key)
  return value
}

function containerValue(container: unknown, key: string | number): unknown {
  if (Array.isArray(container) && typeof key === 'number') return container[key]
  if (isRecord(container) && typeof key === 'string') return container[key]
  return undefined
}

function setValue(path: Path, value: unknown) {
  let container: unknown = snapshot.value
  for (const key of path.slice(0, -1))
    container = containerValue(container, key)
  const key = path.at(-1)
  if (Array.isArray(container) && typeof key === 'number')
    container[key] = value
  if (isRecord(container) && typeof key === 'string') container[key] = value
  emit('save', props.draft)
}

function addRecord(path: Path, value: EditableRecord) {
  const values = recordsAt(path)
  values.push(value)
  emit('save', props.draft)
}

function removeRecord(path: Path, index: number) {
  recordsAt(path).splice(index, 1)
  emit('save', props.draft)
}

function entriesAt(path: Path): [string, string][] {
  return Object.entries(recordAt(path)).map(([key, value]) => [
    key,
    String(value),
  ])
}

function setEntry(path: Path, previousKey: string, key: string, value: string) {
  const map = recordAt(path)
  if (previousKey !== key) delete map[previousKey]
  map[key] = value
  emit('save', props.draft)
}

function addEntry(path: Path, candidates: readonly string[]) {
  const map = recordAt(path)
  const key = candidates.find((candidate) => !(candidate in map))
  if (!key) return
  map[key] = accFields()[0] ?? ''
  emit('save', props.draft)
}

function removeEntry(path: Path, key: string) {
  delete recordAt(path)[key]
  emit('save', props.draft)
}

function toggleCapability(value: string, checked: boolean) {
  const capabilities = valueAt(['capabilities']) as string[]
  const next = checked
    ? [...new Set([...capabilities, value])]
    : capabilities.filter((item) => item !== value)
  setValue(['capabilities'], next)
}

function isRecord(value: unknown): value is EditableRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function options(key: string) {
  return props.referenceOptions[key] ?? []
}

function exactReference(value: Record<string, unknown> = {}) {
  return {
    objectId: String(value.objectId ?? ''),
    approvalEntryId: String(value.approvalEntryId ?? ''),
    code: String(value.code ?? ''),
    name: String(value.name ?? ''),
  }
}

function auxReference(value: Record<string, unknown> = {}) {
  return {
    id: String(value.objectId ?? value.id ?? ''),
    code: String(value.code ?? ''),
    name: String(value.name ?? ''),
    ...(typeof value.behaviorProfile === 'string' && {
      behaviorProfile: value.behaviorProfile,
    }),
    ...(typeof value.quantityScale === 'number' && {
      quantityScale: value.quantityScale,
    }),
  }
}

function accFields() {
  const vouEntityId = String(valueAt(['vouEntity', 'id']) ?? '')
  const vou = options('accVouEntity').find((item) => item.id === vouEntityId)
  const catalog = vou?.fieldCatalog as Record<string, unknown> | undefined
  return [
    ...((catalog?.headerFields as string[] | undefined) ?? []),
    ...((catalog?.lineFields as string[] | undefined) ?? []),
  ]
}

function accSubjects() {
  const bookId = String(valueAt(['book', 'id']) ?? '')
  return options('accSubject').filter((item) => item.bookId === bookId)
}

function subjectDimensions(subjectId: unknown) {
  return (
    (accSubjects().find((item) => item.id === subjectId)?.requiredDimensions as
      string[] | undefined) ?? []
  )
}

function dimensionsComplete(value: unknown, candidates: readonly string[]) {
  return isRecord(value) && candidates.every((dimension) => dimension in value)
}
</script>

<template>
  <section class="structured-editor" :aria-label="`${draft.entity} 业务资料`">
    <fieldset v-if="fields.length" class="common-fields">
      <legend>基本资料</legend>
      <label v-for="field in fields" :key="field.key">
        <template v-if="field.kind === 'boolean'">
          <input
            type="checkbox"
            :checked="Boolean(valueAt([field.key]))"
            @change="
              setValue([field.key], ($event.target as HTMLInputElement).checked)
            "
          />
          {{ field.label }}
        </template>
        <template v-else>
          {{ field.label }}
          <select
            v-if="field.kind === 'identity-kind'"
            :value="valueAt([field.key])"
            @change="
              setValue([field.key], ($event.target as HTMLSelectElement).value)
            "
          >
            <option value="ORGANIZATION">组织</option>
            <option value="PERSON">个人</option>
          </select>
          <select
            v-else-if="field.kind === 'mapping-result'"
            :value="valueAt([field.key])"
            @change="
              setValue([field.key], ($event.target as HTMLSelectElement).value)
            "
          >
            <option value="POST">记账</option>
            <option value="UN_POST">不记账</option>
          </select>
          <input
            v-else
            :type="field.kind === 'number' ? 'number' : 'text'"
            :value="String(valueAt([field.key]) ?? '')"
            @input="
              setValue(
                [field.key],
                field.kind === 'number'
                  ? Number(($event.target as HTMLInputElement).value)
                  : ($event.target as HTMLInputElement).value,
              )
            "
          />
        </template>
      </label>
    </fieldset>

    <template v-if="draft.entity === 'vehicle'">
      <ArchiveReferenceEditor
        label="车辆类型引用"
        :value="recordAt(['vehicleType'])"
        :options="options('vehicleType')"
        @select="(value) => setValue(['vehicleType'], auxReference(value))"
      />
      <fieldset>
        <legend>承运方设置</legend>
        <label>
          类型
          <select
            :value="valueAt(['carrier', 'kind'])"
            @change="
              setValue(
                ['carrier'],
                ($event.target as HTMLSelectElement).value === 'INTERNAL'
                  ? {
                      kind: 'INTERNAL',
                      operatingEntityId: '',
                      approvalEntryId: '',
                    }
                  : {
                      kind: 'EXTERNAL',
                      otherUnitId: '',
                      approvalEntryId: '',
                    },
              )
            "
          >
            <option
              v-for="(label, value) in labels.carrier"
              :key="value"
              :value="value"
            >
              {{ label }}
            </option>
          </select>
        </label>
        <ArchiveReferenceEditor
          label="承运方引用"
          :value="recordAt(['carrier'])"
          :options="
            options(
              valueAt(['carrier', 'kind']) === 'INTERNAL'
                ? 'operatingEntity'
                : 'otherUnit',
            )
          "
          @select="
            (value) =>
              setValue(
                ['carrier'],
                valueAt(['carrier', 'kind']) === 'INTERNAL'
                  ? {
                      kind: 'INTERNAL',
                      operatingEntityId: value.objectId,
                      approvalEntryId: value.approvalEntryId,
                    }
                  : {
                      kind: 'EXTERNAL',
                      otherUnitId: value.objectId,
                      approvalEntryId: value.approvalEntryId,
                    },
              )
          "
        />
      </fieldset>
    </template>

    <ArchiveReferenceEditor
      v-else-if="draft.entity === 'fund-account'"
      label="所属经营主体"
      :value="recordAt(['operatingEntity'])"
      :options="options('operatingEntity')"
      @select="(value) => setValue(['operatingEntity'], exactReference(value))"
    />

    <template v-else-if="draft.entity === 'product'">
      <ArchiveReferenceEditor
        label="产品类型引用"
        :value="recordAt(['productType'])"
        :options="options('productType')"
        @select="(value) => setValue(['productType'], auxReference(value))"
      />
      <p>
        产品行为：{{
          productBehaviorLabel(valueAt(['productType', 'behaviorProfile']))
        }}
      </p>
      <ArchiveReferenceEditor
        label="产品分类引用"
        :value="recordAt(['productCategory'])"
        :options="options('productCategory')"
        @select="(value) => setValue(['productCategory'], auxReference(value))"
      />
      <ArchiveReferenceEditor
        label="计价单位引用"
        :value="recordAt(['pricingUnit'])"
        :options="options('measurementUnit')"
        @select="(value) => setValue(['pricingUnit'], auxReference(value))"
      />
      <label
        >计价数量精度
        <input
          type="number"
          :value="valueAt(['pricingUnit', 'quantityScale'])"
          @input="
            setValue(
              ['pricingUnit', 'quantityScale'],
              Number(($event.target as HTMLInputElement).value),
            )
          "
      /></label>
      <ArchiveReferenceEditor
        label="默认入库单位引用"
        :value="recordAt(['defaultInputUnit'])"
        :options="options('measurementUnit')"
        @select="(value) => setValue(['defaultInputUnit'], auxReference(value))"
      />
      <label
        >入库数量精度
        <input
          type="number"
          :value="valueAt(['defaultInputUnit', 'quantityScale'])"
          @input="
            setValue(
              ['defaultInputUnit', 'quantityScale'],
              Number(($event.target as HTMLInputElement).value),
            )
          "
      /></label>
    </template>

    <template v-else-if="draft.entity === 'employee'">
      <ArchiveReferenceEditor
        label="人员类别引用"
        :value="recordAt(['employeeCategory'])"
        :options="options('employeeCategory')"
        @select="(value) => setValue(['employeeCategory'], auxReference(value))"
      />
      <ArchiveReferenceEditor
        label="部门引用"
        :value="recordAt(['department'])"
        :options="options('department')"
        @select="(value) => setValue(['department'], auxReference(value))"
      />
      <ArchiveReferenceEditor
        label="岗位引用"
        :value="recordAt(['position'])"
        :options="options('position')"
        @select="(value) => setValue(['position'], auxReference(value))"
      />
      <ArchiveReferenceEditor
        label="任职经营主体"
        :value="recordAt(['operatingEntity'])"
        :options="options('operatingEntity')"
        @select="
          (value) => setValue(['operatingEntity'], exactReference(value))
        "
      />
    </template>

    <template
      v-else-if="
        draft.entity === 'supplier' ||
        draft.entity === 'other-unit' ||
        draft.entity === 'sales-partner'
      "
    >
      <fieldset>
        <legend>适用经营主体</legend>
        <div
          v-for="(reference, index) in recordsAt(['operatingEntities'])"
          :key="index"
        >
          <ArchiveReferenceEditor
            :label="`经营主体 ${index + 1}`"
            :value="reference"
            :options="options('operatingEntity')"
            @select="
              (value) =>
                setValue(['operatingEntities', index], exactReference(value))
            "
          />
          <button
            type="button"
            @click="removeRecord(['operatingEntities'], index)"
          >
            移除经营主体
          </button>
        </div>
        <button
          type="button"
          @click="addRecord(['operatingEntities'], exactReference())"
        >
          添加经营主体
        </button>
        <label
          >默认经营主体
          <select
            :value="String(valueAt(['defaultOperatingEntityId']) ?? '')"
            @change="
              setValue(
                ['defaultOperatingEntityId'],
                ($event.target as HTMLSelectElement).value || null,
              )
            "
          >
            <option value="">未选择</option>
            <option
              v-for="option in options('operatingEntity')"
              :key="String(option.objectId)"
              :value="String(option.objectId)"
            >
              {{ option.code }} · {{ option.name }}
            </option>
          </select></label
        >
      </fieldset>
      <fieldset v-if="draft.entity !== 'sales-partner'">
        <legend>结算方式</legend>
        <ArchiveReferenceEditor
          label="结算方式"
          :value="recordAt(['settlementMethod'])"
          :options="options('settlementMethod')"
          @select="
            (value) => setValue(['settlementMethod'], auxReference(value))
          "
        />
        <template v-if="valueAt(['settlementMethod']) !== null">
          <button type="button" @click="setValue(['settlementMethod'], null)">
            清除结算方式
          </button>
        </template>
      </fieldset>
      <fieldset v-if="draft.entity === 'supplier'">
        <legend>默认采购员</legend>
        <ArchiveReferenceEditor
          label="默认采购员"
          :value="recordAt(['defaultPurchaser'])"
          :options="options('employee')"
          @select="
            (value) => setValue(['defaultPurchaser'], exactReference(value))
          "
        />
        <template v-if="valueAt(['defaultPurchaser']) !== null">
          <button type="button" @click="setValue(['defaultPurchaser'], null)">
            清除采购员
          </button>
        </template>
      </fieldset>
      <fieldset v-if="draft.entity === 'sales-partner'">
        <legend>合作能力</legend>
        <label v-for="(label, value) in labels.capability" :key="value">
          <input
            type="checkbox"
            :checked="(valueAt(['capabilities']) as string[]).includes(value)"
            @change="
              toggleCapability(
                value,
                ($event.target as HTMLInputElement).checked,
              )
            "
          />
          {{ label }}
        </label>
      </fieldset>
    </template>

    <template v-else-if="draft.entity === 'customer'">
      <fieldset>
        <legend>付款资料</legend>
        <div
          v-for="(profile, index) in recordsAt(['remittanceProfiles'])"
          :key="index"
        >
          <label
            >付款户名
            <input
              :value="profile.payerName"
              @input="
                setValue(
                  ['remittanceProfiles', index, 'payerName'],
                  ($event.target as HTMLInputElement).value,
                )
              "
          /></label>
          <label
            >开户银行
            <input
              :value="profile.bank"
              @input="
                setValue(
                  ['remittanceProfiles', index, 'bank'],
                  ($event.target as HTMLInputElement).value,
                )
              "
          /></label>
          <label
            >账号
            <input
              :value="profile.accountNumber"
              @input="
                setValue(
                  ['remittanceProfiles', index, 'accountNumber'],
                  ($event.target as HTMLInputElement).value,
                )
              "
          /></label>
          <button
            type="button"
            @click="removeRecord(['remittanceProfiles'], index)"
          >
            删除付款资料
          </button>
        </div>
        <button
          type="button"
          @click="
            addRecord(['remittanceProfiles'], {
              payerName: '',
              bank: '',
              accountNumber: '',
            })
          "
        >
          添加付款资料
        </button>
      </fieldset>
      <fieldset>
        <legend>默认经营主体</legend>
        <ArchiveReferenceEditor
          label="默认经营主体"
          :value="recordAt(['defaultOperatingEntity'])"
          :options="options('operatingEntity')"
          @select="
            (value) =>
              setValue(['defaultOperatingEntity'], exactReference(value))
          "
        />
        <template v-if="valueAt(['defaultOperatingEntity']) !== null">
          <button
            type="button"
            @click="setValue(['defaultOperatingEntity'], null)"
          >
            清除经营主体
          </button>
        </template>
      </fieldset>
      <fieldset>
        <legend>客户子单位</legend>
        <article
          v-for="(subunit, index) in recordsAt(['subunits'])"
          :key="String(subunit.id)"
        >
          <h4>
            子单位 {{ index + 1 }} ·
            {{ subunit.intent === 'NEW' ? '新增' : '既有' }}
          </h4>
          <label
            >名称
            <input
              :value="subunit.name"
              @input="
                setValue(
                  ['subunits', index, 'name'],
                  ($event.target as HTMLInputElement).value,
                )
              "
          /></label>
          <label
            >联系人
            <input
              :value="subunit.contactName"
              @input="
                setValue(
                  ['subunits', index, 'contactName'],
                  ($event.target as HTMLInputElement).value,
                )
              "
          /></label>
          <label
            >业务地址
            <input
              :value="subunit.address"
              @input="
                setValue(
                  ['subunits', index, 'address'],
                  ($event.target as HTMLInputElement).value,
                )
              "
          /></label>
          <label
            >客户类型
            <input
              :value="subunit.customerType"
              @input="
                setValue(
                  ['subunits', index, 'customerType'],
                  ($event.target as HTMLInputElement).value,
                )
              "
          /></label>
          <label
            >收款方式
            <input
              :value="subunit.receiptMethod"
              @input="
                setValue(
                  ['subunits', index, 'receiptMethod'],
                  ($event.target as HTMLInputElement).value,
                )
              "
          /></label>
          <label
            >运输方式
            <input
              :value="subunit.transportMethod"
              @input="
                setValue(
                  ['subunits', index, 'transportMethod'],
                  ($event.target as HTMLInputElement).value,
                )
              "
          /></label>
          <label
            >定价政策
            <input
              :value="subunit.pricePolicy"
              @input="
                setValue(
                  ['subunits', index, 'pricePolicy'],
                  ($event.target as HTMLInputElement).value,
                )
              "
          /></label>
          <fieldset>
            <legend>结算方式</legend>
            <ArchiveReferenceEditor
              label="子单位结算方式"
              :value="recordAt(['subunits', index, 'settlementMethod'])"
              :options="options('settlementMethod')"
              @select="
                (value) =>
                  setValue(
                    ['subunits', index, 'settlementMethod'],
                    auxReference(value),
                  )
              "
            />
            <template v-if="subunit.settlementMethod !== null">
              <button
                type="button"
                @click="setValue(['subunits', index, 'settlementMethod'], null)"
              >
                清除结算方式
              </button>
            </template>
          </fieldset>
          <fieldset>
            <legend>信用额度</legend>
            <div
              v-for="(limit, limitIndex) in recordsAt([
                'subunits',
                index,
                'creditLimits',
              ])"
              :key="limitIndex"
            >
              <label
                >币种
                <input
                  :value="limit.currency"
                  @input="
                    setValue(
                      [
                        'subunits',
                        index,
                        'creditLimits',
                        limitIndex,
                        'currency',
                      ],
                      ($event.target as HTMLInputElement).value,
                    )
                  "
              /></label>
              <label
                >额度
                <input
                  inputmode="decimal"
                  :value="limit.amount"
                  @input="
                    setValue(
                      ['subunits', index, 'creditLimits', limitIndex, 'amount'],
                      ($event.target as HTMLInputElement).value,
                    )
                  "
              /></label>
              <button
                type="button"
                @click="
                  removeRecord(['subunits', index, 'creditLimits'], limitIndex)
                "
              >
                删除信用额度
              </button>
            </div>
            <button
              type="button"
              @click="
                addRecord(['subunits', index, 'creditLimits'], {
                  currency: 'CNY',
                  amount: '0',
                })
              "
            >
              添加信用额度
            </button>
          </fieldset>
          <fieldset>
            <legend>销售归属</legend>
            <ArchiveReferenceEditor
              label="子单位销售归属"
              :value="recordAt(['subunits', index, 'salesAttribution'])"
              :options="options('salesPartner')"
              @select="
                (value) =>
                  setValue(
                    ['subunits', index, 'salesAttribution'],
                    exactReference(value),
                  )
              "
            />
            <template v-if="subunit.salesAttribution !== null">
              <button
                type="button"
                @click="setValue(['subunits', index, 'salesAttribution'], null)"
              >
                清除销售归属
              </button>
            </template>
          </fieldset>
          <fieldset>
            <legend>业务附件</legend>
            <label>
              添加业务附件
              <input
                accept="application/pdf,image/jpeg,image/png"
                type="file"
                @change="
                  ($event.target as HTMLInputElement).files?.[0] &&
                  emit(
                    'addCustomerSubunitAttachment',
                    draft,
                    String(subunit.id),
                    ($event.target as HTMLInputElement).files![0],
                  )
                "
              />
            </label>
            <ul>
              <li
                v-for="attachment in recordsAt([
                  'subunits',
                  index,
                  'attachments',
                ])"
                :key="String(attachment.id)"
              >
                {{ attachment.fileName }} · {{ attachment.contentType }}
              </li>
            </ul>
          </fieldset>
          <label
            >内部提醒
            <textarea
              :value="String(subunit.internalReminder ?? '')"
              @input="
                setValue(
                  ['subunits', index, 'internalReminder'],
                  ($event.target as HTMLTextAreaElement).value,
                )
              "
            />
          </label>
          <label
            >订单默认备注
            <textarea
              :value="String(subunit.defaultOrderRemark ?? '')"
              @input="
                setValue(
                  ['subunits', index, 'defaultOrderRemark'],
                  ($event.target as HTMLTextAreaElement).value,
                )
              "
            />
          </label>
          <label
            ><input
              type="checkbox"
              :checked="Boolean(subunit.enabled)"
              @change="
                setValue(
                  ['subunits', index, 'enabled'],
                  ($event.target as HTMLInputElement).checked,
                )
              "
            />
            启用子单位</label
          >
          <button
            type="button"
            :disabled="recordsAt(['subunits']).length === 1"
            @click="removeRecord(['subunits'], index)"
          >
            删除子单位
          </button>
        </article>
        <button
          type="button"
          @click="
            addRecord(['subunits'], {
              id: createTargetId(),
              intent: 'NEW',
              code: null,
              name: '新子单位',
              contactName: '',
              address: '',
              customerType: '',
              settlementMethod: null,
              receiptMethod: '',
              transportMethod: '',
              pricePolicy: '',
              creditLimits: [],
              salesAttribution: null,
              internalReminder: '',
              defaultOrderRemark: '',
              attachments: [],
              enabled: true,
            })
          "
        >
          添加子单位
        </button>
      </fieldset>
      <p>
        已选择身份税务附件：{{ recordsAt(['identityAttachments']).length }}
        个；附件内容仍保存在本机草稿。
      </p>
    </template>

    <template v-else-if="draft.entity === 'acc-mapping'">
      <ArchiveReferenceEditor
        label="账簿引用"
        :value="recordAt(['book'])"
        :options="options('accBook')"
        @select="(value) => setValue(['book'], auxReference(value))"
      />
      <ArchiveReferenceEditor
        label="凭证类型引用"
        :value="recordAt(['vouEntity'])"
        :options="options('accVouEntity')"
        @select="(value) => setValue(['vouEntity'], auxReference(value))"
      />
      <fieldset>
        <legend>凭证模板</legend>
        <article
          v-for="(template, templateIndex) in recordsAt([
            'definition',
            'templates',
          ])"
          :key="String(template.templateId)"
        >
          <label
            >模板编号
            <input
              :value="template.templateId"
              @input="
                setValue(
                  ['definition', 'templates', templateIndex, 'templateId'],
                  ($event.target as HTMLInputElement).value,
                )
              "
          /></label>
          <label
            >明细集合字段
            <input
              :value="String(template.collection ?? '')"
              @input="
                setValue(
                  ['definition', 'templates', templateIndex, 'collection'],
                  ($event.target as HTMLInputElement).value || null,
                )
              "
          /></label>
          <fieldset>
            <legend>分录</legend>
            <div
              v-for="(line, lineIndex) in recordsAt([
                'definition',
                'templates',
                templateIndex,
                'lines',
              ])"
              :key="lineIndex"
            >
              <label
                >科目来源
                <select
                  :value="line.subjectSource"
                  @change="
                    setValue(
                      [
                        'definition',
                        'templates',
                        templateIndex,
                        'lines',
                        lineIndex,
                        'subjectSource',
                      ],
                      ($event.target as HTMLSelectElement).value,
                    )
                  "
                >
                  <option
                    v-for="(label, value) in labels.subjectSource"
                    :key="value"
                    :value="value"
                  >
                    {{ label }}
                  </option>
                </select></label
              >
              <label
                >科目或字段
                <select
                  :value="line.subjectValue"
                  @input="
                    setValue(
                      [
                        'definition',
                        'templates',
                        templateIndex,
                        'lines',
                        lineIndex,
                        'subjectValue',
                      ],
                      ($event.target as HTMLSelectElement).value,
                    )
                  "
                >
                  <option value="">未选择</option>
                  <option
                    v-for="option in line.subjectSource === 'FIXED'
                      ? options('accSubject')
                      : accFields()"
                    :key="
                      typeof option === 'string' ? option : String(option.id)
                    "
                    :value="
                      typeof option === 'string' ? option : String(option.id)
                    "
                  >
                    {{
                      typeof option === 'string'
                        ? option
                        : `${option.code} · ${option.name}`
                    }}
                  </option>
                </select></label
              >
              <label
                >方向
                <select
                  :value="line.direction"
                  @change="
                    setValue(
                      [
                        'definition',
                        'templates',
                        templateIndex,
                        'lines',
                        lineIndex,
                        'direction',
                      ],
                      ($event.target as HTMLSelectElement).value,
                    )
                  "
                >
                  <option
                    v-for="(label, value) in labels.direction"
                    :key="value"
                    :value="value"
                  >
                    {{ label }}
                  </option>
                </select></label
              >
              <label
                >金额字段
                <select
                  :value="line.amountField"
                  @change="
                    setValue(
                      [
                        'definition',
                        'templates',
                        templateIndex,
                        'lines',
                        lineIndex,
                        'amountField',
                      ],
                      ($event.target as HTMLSelectElement).value,
                    )
                  "
                >
                  <option
                    v-for="field in accFields()"
                    :key="field"
                    :value="field"
                  >
                    {{ field }}
                  </option>
                </select></label
              >
              <label
                >币种字段
                <select
                  :value="line.currencyField"
                  @change="
                    setValue(
                      [
                        'definition',
                        'templates',
                        templateIndex,
                        'lines',
                        lineIndex,
                        'currencyField',
                      ],
                      ($event.target as HTMLSelectElement).value,
                    )
                  "
                >
                  <option
                    v-for="field in accFields()"
                    :key="field"
                    :value="field"
                  >
                    {{ field }}
                  </option>
                </select></label
              >
              <label
                >数量字段
                <select
                  :value="String(line.quantityField ?? '')"
                  @change="
                    setValue(
                      [
                        'definition',
                        'templates',
                        templateIndex,
                        'lines',
                        lineIndex,
                        'quantityField',
                      ],
                      ($event.target as HTMLSelectElement).value || null,
                    )
                  "
                >
                  <option value="">不使用数量</option>
                  <option
                    v-for="field in accFields()"
                    :key="field"
                    :value="field"
                  >
                    {{ field }}
                  </option>
                </select></label
              >
              <fieldset>
                <legend>核算维度</legend>
                <div
                  v-for="([key, value], dimensionIndex) in entriesAt([
                    'definition',
                    'templates',
                    templateIndex,
                    'lines',
                    lineIndex,
                    'dimensions',
                  ])"
                  :key="`${key}-${dimensionIndex}`"
                >
                  <label
                    >维度字段
                    <select
                      :value="key"
                      @change="
                        setEntry(
                          [
                            'definition',
                            'templates',
                            templateIndex,
                            'lines',
                            lineIndex,
                            'dimensions',
                          ],
                          key,
                          ($event.target as HTMLSelectElement).value,
                          value,
                        )
                      "
                    >
                      <option
                        v-for="dimension in subjectDimensions(
                          line.subjectSource === 'FIXED'
                            ? line.subjectValue
                            : '',
                        )"
                        :key="dimension"
                        :value="dimension"
                      >
                        {{ dimension }}
                      </option>
                    </select></label
                  >
                  <label
                    >维度值
                    <select
                      :value="value"
                      @change="
                        setEntry(
                          [
                            'definition',
                            'templates',
                            templateIndex,
                            'lines',
                            lineIndex,
                            'dimensions',
                          ],
                          key,
                          key,
                          ($event.target as HTMLSelectElement).value,
                        )
                      "
                    >
                      <option
                        v-for="field in accFields()"
                        :key="field"
                        :value="field"
                      >
                        {{ field }}
                      </option>
                    </select></label
                  >
                  <button
                    type="button"
                    @click="
                      removeEntry(
                        [
                          'definition',
                          'templates',
                          templateIndex,
                          'lines',
                          lineIndex,
                          'dimensions',
                        ],
                        key,
                      )
                    "
                  >
                    删除维度
                  </button>
                </div>
                <button
                  type="button"
                  :disabled="
                    dimensionsComplete(
                      line.dimensions,
                      subjectDimensions(
                        line.subjectSource === 'FIXED' ? line.subjectValue : '',
                      ),
                    )
                  "
                  @click="
                    addEntry(
                      [
                        'definition',
                        'templates',
                        templateIndex,
                        'lines',
                        lineIndex,
                        'dimensions',
                      ],
                      subjectDimensions(
                        line.subjectSource === 'FIXED' ? line.subjectValue : '',
                      ),
                    )
                  "
                >
                  添加维度
                </button>
              </fieldset>
              <label
                >成本对方科目
                <select
                  :value="String(line.costCounterpartSubjectId ?? '')"
                  @change="
                    setValue(
                      [
                        'definition',
                        'templates',
                        templateIndex,
                        'lines',
                        lineIndex,
                        'costCounterpartSubjectId',
                      ],
                      ($event.target as HTMLSelectElement).value || null,
                    )
                  "
                >
                  <option value="">不使用成本对方科目</option>
                  <option
                    v-for="subject in accSubjects()"
                    :key="String(subject.id)"
                    :value="String(subject.id)"
                  >
                    {{ subject.code }} · {{ subject.name }}
                  </option>
                </select></label
              >
              <fieldset>
                <legend>成本对方维度</legend>
                <div
                  v-for="([key, value], dimensionIndex) in entriesAt([
                    'definition',
                    'templates',
                    templateIndex,
                    'lines',
                    lineIndex,
                    'costCounterpartDimensions',
                  ])"
                  :key="`${key}-${dimensionIndex}`"
                >
                  <label
                    >维度字段
                    <select
                      :value="key"
                      @change="
                        setEntry(
                          [
                            'definition',
                            'templates',
                            templateIndex,
                            'lines',
                            lineIndex,
                            'costCounterpartDimensions',
                          ],
                          key,
                          ($event.target as HTMLSelectElement).value,
                          value,
                        )
                      "
                    >
                      <option
                        v-for="dimension in subjectDimensions(
                          line.costCounterpartSubjectId,
                        )"
                        :key="dimension"
                        :value="dimension"
                      >
                        {{ dimension }}
                      </option>
                    </select></label
                  >
                  <label
                    >维度值
                    <select
                      :value="value"
                      @change="
                        setEntry(
                          [
                            'definition',
                            'templates',
                            templateIndex,
                            'lines',
                            lineIndex,
                            'costCounterpartDimensions',
                          ],
                          key,
                          key,
                          ($event.target as HTMLSelectElement).value,
                        )
                      "
                    >
                      <option
                        v-for="field in accFields()"
                        :key="field"
                        :value="field"
                      >
                        {{ field }}
                      </option>
                    </select></label
                  >
                  <button
                    type="button"
                    @click="
                      removeEntry(
                        [
                          'definition',
                          'templates',
                          templateIndex,
                          'lines',
                          lineIndex,
                          'costCounterpartDimensions',
                        ],
                        key,
                      )
                    "
                  >
                    删除维度
                  </button>
                </div>
                <button
                  type="button"
                  :disabled="
                    dimensionsComplete(
                      line.costCounterpartDimensions,
                      subjectDimensions(line.costCounterpartSubjectId),
                    )
                  "
                  @click="
                    addEntry(
                      [
                        'definition',
                        'templates',
                        templateIndex,
                        'lines',
                        lineIndex,
                        'costCounterpartDimensions',
                      ],
                      subjectDimensions(line.costCounterpartSubjectId),
                    )
                  "
                >
                  添加成本对方维度
                </button>
              </fieldset>
              <button
                type="button"
                @click="
                  removeRecord(
                    ['definition', 'templates', templateIndex, 'lines'],
                    lineIndex,
                  )
                "
              >
                删除分录
              </button>
            </div>
            <button
              type="button"
              @click="
                addRecord(['definition', 'templates', templateIndex, 'lines'], {
                  subjectSource: 'FIELD',
                  subjectValue: 'subjectId',
                  direction: 'DEBIT',
                  amountField: 'amount',
                  currencyField: 'currency',
                  dimensions: {},
                  quantityField: null,
                  costCounterpartSubjectId: null,
                  costCounterpartDimensions: {},
                })
              "
            >
              添加分录
            </button>
          </fieldset>
          <button
            type="button"
            @click="removeRecord(['definition', 'templates'], templateIndex)"
          >
            删除模板
          </button>
        </article>
        <button
          type="button"
          @click="
            addRecord(['definition', 'templates'], {
              templateId: `template-${recordsAt(['definition', 'templates']).length + 1}`,
              collection: null,
              lines: [],
            })
          "
        >
          添加模板
        </button>
        <label
          >默认模板
          <select
            :value="String(valueAt(['definition', 'defaultTemplateId']) ?? '')"
            @change="
              setValue(
                ['definition', 'defaultTemplateId'],
                ($event.target as HTMLSelectElement).value || null,
              )
            "
          >
            <option value="">不使用模板</option>
            <option
              v-for="template in recordsAt(['definition', 'templates'])"
              :key="String(template.templateId)"
              :value="String(template.templateId)"
            >
              {{ template.templateId }}
            </option>
          </select></label
        >
      </fieldset>
      <fieldset>
        <legend>固定资产配置</legend>
        <button
          v-if="valueAt(['definition', 'assetConfiguration']) === null"
          type="button"
          @click="
            setValue(['definition', 'assetConfiguration'], {
              assetSubjectId: '',
              assetDimensions: {},
              accumulatedDepreciationSubjectId: '',
              accumulatedDepreciationDimensions: {},
              depreciationExpenseSubjectId: '',
              depreciationExpenseDimensions: {},
            })
          "
        >
          启用固定资产配置
        </button>
        <template v-else>
          <label
            >资产科目
            <select
              :value="
                String(
                  valueAt([
                    'definition',
                    'assetConfiguration',
                    'assetSubjectId',
                  ]) ?? '',
                )
              "
              @change="
                setValue(
                  ['definition', 'assetConfiguration', 'assetSubjectId'],
                  ($event.target as HTMLSelectElement).value,
                )
              "
            >
              <option value="">未选择</option>
              <option
                v-for="subject in accSubjects()"
                :key="String(subject.id)"
                :value="String(subject.id)"
              >
                {{ subject.code }} · {{ subject.name }}
              </option>
            </select></label
          >
          <label
            >累计折旧科目
            <select
              :value="
                String(
                  valueAt([
                    'definition',
                    'assetConfiguration',
                    'accumulatedDepreciationSubjectId',
                  ]) ?? '',
                )
              "
              @change="
                setValue(
                  [
                    'definition',
                    'assetConfiguration',
                    'accumulatedDepreciationSubjectId',
                  ],
                  ($event.target as HTMLSelectElement).value,
                )
              "
            >
              <option value="">未选择</option>
              <option
                v-for="subject in accSubjects()"
                :key="String(subject.id)"
                :value="String(subject.id)"
              >
                {{ subject.code }} · {{ subject.name }}
              </option>
            </select></label
          >
          <label
            >折旧费用科目
            <select
              :value="
                String(
                  valueAt([
                    'definition',
                    'assetConfiguration',
                    'depreciationExpenseSubjectId',
                  ]) ?? '',
                )
              "
              @change="
                setValue(
                  [
                    'definition',
                    'assetConfiguration',
                    'depreciationExpenseSubjectId',
                  ],
                  ($event.target as HTMLSelectElement).value,
                )
              "
            >
              <option value="">未选择</option>
              <option
                v-for="subject in accSubjects()"
                :key="String(subject.id)"
                :value="String(subject.id)"
              >
                {{ subject.code }} · {{ subject.name }}
              </option>
            </select></label
          >
          <fieldset
            v-for="[title, field] in [
              ['资产维度', 'assetDimensions'],
              ['累计折旧维度', 'accumulatedDepreciationDimensions'],
              ['折旧费用维度', 'depreciationExpenseDimensions'],
            ]"
            :key="field"
          >
            <legend>{{ title }}</legend>
            <div
              v-for="([key, value], dimensionIndex) in entriesAt([
                'definition',
                'assetConfiguration',
                field,
              ])"
              :key="`${key}-${dimensionIndex}`"
            >
              <label
                >维度字段
                <select
                  :value="key"
                  @change="
                    setEntry(
                      ['definition', 'assetConfiguration', field],
                      key,
                      ($event.target as HTMLSelectElement).value,
                      value,
                    )
                  "
                >
                  <option
                    v-for="dimension in subjectDimensions(
                      valueAt([
                        'definition',
                        'assetConfiguration',
                        field === 'assetDimensions'
                          ? 'assetSubjectId'
                          : field === 'accumulatedDepreciationDimensions'
                            ? 'accumulatedDepreciationSubjectId'
                            : 'depreciationExpenseSubjectId',
                      ]),
                    )"
                    :key="dimension"
                    :value="dimension"
                  >
                    {{ dimension }}
                  </option>
                </select></label
              >
              <label
                >维度值
                <select
                  :value="value"
                  @change="
                    setEntry(
                      ['definition', 'assetConfiguration', field],
                      key,
                      key,
                      ($event.target as HTMLSelectElement).value,
                    )
                  "
                >
                  <option
                    v-for="sourceField in accFields()"
                    :key="sourceField"
                    :value="sourceField"
                  >
                    {{ sourceField }}
                  </option>
                </select></label
              >
              <button
                type="button"
                @click="
                  removeEntry(['definition', 'assetConfiguration', field], key)
                "
              >
                删除维度
              </button>
            </div>
            <button
              type="button"
              @click="
                addEntry(
                  ['definition', 'assetConfiguration', field],
                  subjectDimensions(
                    valueAt([
                      'definition',
                      'assetConfiguration',
                      field === 'assetDimensions'
                        ? 'assetSubjectId'
                        : field === 'accumulatedDepreciationDimensions'
                          ? 'accumulatedDepreciationSubjectId'
                          : 'depreciationExpenseSubjectId',
                    ]),
                  ),
                )
              "
            >
              添加维度
            </button>
          </fieldset>
          <button
            type="button"
            @click="setValue(['definition', 'assetConfiguration'], null)"
          >
            清除固定资产配置
          </button>
        </template>
      </fieldset>
      <fieldset>
        <legend>条件规则</legend>
        <article
          v-for="(rule, ruleIndex) in recordsAt(['definition', 'rules'])"
          :key="ruleIndex"
        >
          <label
            >结果
            <select
              :value="rule.result"
              @change="
                setValue(
                  ['definition', 'rules', ruleIndex, 'result'],
                  ($event.target as HTMLSelectElement).value,
                )
              "
            >
              <option
                v-for="(label, value) in labels.mappingResult"
                :key="value"
                :value="value"
              >
                {{ label }}
              </option>
            </select></label
          >
          <label
            >模板
            <select
              :value="String(rule.templateId ?? '')"
              @change="
                setValue(
                  ['definition', 'rules', ruleIndex, 'templateId'],
                  ($event.target as HTMLSelectElement).value || null,
                )
              "
            >
              <option value="">不使用模板</option>
              <option
                v-for="template in recordsAt(['definition', 'templates'])"
                :key="String(template.templateId)"
                :value="String(template.templateId)"
              >
                {{ template.templateId }}
              </option>
            </select></label
          >
          <div
            v-for="(condition, conditionIndex) in recordsAt([
              'definition',
              'rules',
              ruleIndex,
              'conditions',
            ])"
            :key="conditionIndex"
          >
            <label
              >字段
              <select
                :value="condition.field"
                @change="
                  setValue(
                    [
                      'definition',
                      'rules',
                      ruleIndex,
                      'conditions',
                      conditionIndex,
                      'field',
                    ],
                    ($event.target as HTMLSelectElement).value,
                  )
                "
              >
                <option
                  v-for="field in accFields()"
                  :key="field"
                  :value="field"
                >
                  {{ field }}
                </option>
              </select></label
            >
            <label
              >判断
              <select
                :value="condition.operator"
                @change="
                  setValue(
                    [
                      'definition',
                      'rules',
                      ruleIndex,
                      'conditions',
                      conditionIndex,
                      'operator',
                    ],
                    ($event.target as HTMLSelectElement).value,
                  )
                "
              >
                <option
                  v-for="(label, value) in labels.condition"
                  :key="value"
                  :value="value"
                >
                  {{ label }}
                </option>
              </select></label
            >
            <label
              >值（逗号分隔）
              <input
                :value="(condition.values as string[]).join(',')"
                @input="
                  setValue(
                    [
                      'definition',
                      'rules',
                      ruleIndex,
                      'conditions',
                      conditionIndex,
                      'values',
                    ],
                    ($event.target as HTMLInputElement).value
                      .split(',')
                      .map((value) => value.trim())
                      .filter(Boolean),
                  )
                "
            /></label>
          </div>
          <button
            type="button"
            @click="
              addRecord(['definition', 'rules', ruleIndex, 'conditions'], {
                field: 'status',
                operator: 'EQ',
                values: ['APPROVED'],
              })
            "
          >
            添加条件
          </button>
          <button
            type="button"
            @click="removeRecord(['definition', 'rules'], ruleIndex)"
          >
            删除规则
          </button>
        </article>
        <button
          type="button"
          @click="
            addRecord(['definition', 'rules'], {
              conditions: [
                { field: 'status', operator: 'EQ', values: ['APPROVED'] },
              ],
              result: 'POST',
              templateId: null,
            })
          "
        >
          添加规则
        </button>
      </fieldset>
    </template>

    <template v-else-if="draft.entity === 'rpt-definition'">
      <fieldset>
        <legend>报表参数</legend>
        <div
          v-for="(parameter, index) in recordsAt(['parameters'])"
          :key="index"
        >
          <label
            >参数键
            <input
              :value="parameter.key"
              @input="
                setValue(
                  ['parameters', index, 'key'],
                  ($event.target as HTMLInputElement).value,
                )
              "
          /></label>
          <label
            >显示名称
            <input
              :value="parameter.name"
              @input="
                setValue(
                  ['parameters', index, 'name'],
                  ($event.target as HTMLInputElement).value,
                )
              "
          /></label>
          <label
            >类型
            <select
              :value="parameter.type"
              @change="
                setValue(
                  ['parameters', index, 'type'],
                  ($event.target as HTMLSelectElement).value,
                )
              "
            >
              <option
                v-for="(label, value) in labels.reportType"
                :key="value"
                :value="value"
                :disabled="value === 'DATETIME'"
              >
                {{ label }}
              </option>
            </select></label
          >
          <label
            ><input
              type="checkbox"
              :checked="Boolean(parameter.required)"
              @change="
                setValue(
                  ['parameters', index, 'required'],
                  ($event.target as HTMLInputElement).checked,
                )
              "
            />
            必填</label
          >
          <button type="button" @click="removeRecord(['parameters'], index)">
            删除参数
          </button>
        </div>
        <button
          type="button"
          @click="
            addRecord(['parameters'], {
              key: `parameter_${recordsAt(['parameters']).length + 1}`,
              name: '新参数',
              type: 'TEXT',
              required: false,
            })
          "
        >
          添加参数
        </button>
      </fieldset>
      <fieldset>
        <legend>结果列</legend>
        <div v-for="(column, index) in recordsAt(['columns'])" :key="index">
          <label
            >字段别名
            <input
              :value="column.alias"
              @input="
                setValue(
                  ['columns', index, 'alias'],
                  ($event.target as HTMLInputElement).value,
                )
              "
          /></label>
          <label
            >显示名称
            <input
              :value="column.name"
              @input="
                setValue(
                  ['columns', index, 'name'],
                  ($event.target as HTMLInputElement).value,
                )
              "
          /></label>
          <label
            >类型
            <select
              :value="column.type"
              @change="
                setValue(
                  ['columns', index, 'type'],
                  ($event.target as HTMLSelectElement).value,
                )
              "
            >
              <option
                v-for="(label, value) in labels.reportType"
                :key="value"
                :value="value"
                :disabled="
                  value === 'DATE_RANGE' ||
                  value === 'ENUM' ||
                  value === 'REFERENCE'
                "
              >
                {{ label }}
              </option>
            </select></label
          >
          <label
            >顺序
            <input
              type="number"
              min="1"
              :value="column.order"
              @input="
                setValue(
                  ['columns', index, 'order'],
                  Number(($event.target as HTMLInputElement).value),
                )
              "
          /></label>
          <label
            >宽度
            <input
              type="number"
              min="1"
              :value="column.width"
              @input="
                setValue(
                  ['columns', index, 'width'],
                  Number(($event.target as HTMLInputElement).value),
                )
              "
          /></label>
          <label
            ><input
              type="checkbox"
              :checked="Boolean(column.visible)"
              @change="
                setValue(
                  ['columns', index, 'visible'],
                  ($event.target as HTMLInputElement).checked,
                )
              "
            />
            显示</label
          >
          <label
            >格式
            <input
              :value="column.format"
              @input="
                setValue(
                  ['columns', index, 'format'],
                  ($event.target as HTMLInputElement).value,
                )
              "
          /></label>
          <button type="button" @click="removeRecord(['columns'], index)">
            删除结果列
          </button>
        </div>
        <button
          type="button"
          @click="
            addRecord(['columns'], {
              alias: `column_${recordsAt(['columns']).length + 1}`,
              name: '新列',
              order: recordsAt(['columns']).length + 1,
              type: 'TEXT',
              width: 120,
              visible: true,
              format: '',
            })
          "
        >
          添加结果列
        </button>
      </fieldset>
    </template>
  </section>
</template>
