import { computed, getCurrentScope, onScopeDispose, reactive } from 'vue'
import { apiClient } from '@/api/client'
import { getErrorMessage } from '@/api/types'
import type {
  BusinessObjectField,
  BusinessObjectFieldOption,
} from '@/components/business-object'
import { formatReferenceLabel } from '@/utils/reference-label'
import type { DclVehicleConfig, DclVehicleForm } from './types'

type ReferenceKey =
  | 'vehicleType'
  | 'carrierOperatingEntityId'
  | 'carrierServiceRelationshipObjectId'

interface ReferenceState {
  options: BusinessObjectFieldOption<string>[]
  loading: boolean
  errorMessage: string | null
  requestSequence: number
}

function createState(): ReferenceState {
  return { options: [], loading: false, errorMessage: null, requestSequence: 0 }
}

export function useDclVehicleReferences(config: DclVehicleConfig) {
  const states = reactive<Record<ReferenceKey, ReferenceState>>({
    vehicleType: createState(),
    carrierOperatingEntityId: createState(),
    carrierServiceRelationshipObjectId: createState(),
  })
  const timers = new Map<ReferenceKey, ReturnType<typeof setTimeout>>()

  const editorFields = computed(() =>
    config.fields.map((field): BusinessObjectField<DclVehicleForm> => {
      if (!isReferenceKey(field.key)) return field
      const state = states[field.key]
      return {
        ...field,
        type: 'autocomplete',
        clearable: false,
        loading: state.loading,
        options: state.options,
        disabled: Boolean(state.errorMessage),
        ...(state.errorMessage ? { hint: state.errorMessage } : {}),
      }
    }),
  )

  async function load(
    key: ReferenceKey,
    keyword: string,
    form: Readonly<DclVehicleForm>,
  ): Promise<void> {
    if (!fieldIsVisible(key, form)) return
    const state = states[key]
    const sequence = state.requestSequence + 1
    state.requestSequence = sequence
    state.loading = true
    state.errorMessage = null
    try {
      const loaded = await loadOptions(key, keyword.trim())
      if (state.requestSequence !== sequence) return
      const selectedValue = form[key]
      const selected = state.options.filter(
        (option) => option.value === selectedValue,
      )
      state.options = [...selected, ...loaded].filter(
        (option, index, all) =>
          all.findIndex((candidate) => candidate.value === option.value) ===
          index,
      )
    } catch (error) {
      if (state.requestSequence === sequence) {
        state.errorMessage = `${referenceLabel(key)}加载失败：${getErrorMessage(error)}`
      }
    } finally {
      if (state.requestSequence === sequence) state.loading = false
    }
  }

  function searchEditorReference(
    rawKey: string,
    keyword: string,
    form: Readonly<DclVehicleForm>,
  ): void {
    if (!isReferenceKey(rawKey) || !fieldIsVisible(rawKey, form)) return
    const previous = timers.get(rawKey)
    if (previous) clearTimeout(previous)
    timers.set(
      rawKey,
      setTimeout(() => {
        timers.delete(rawKey)
        void load(rawKey, keyword, form)
      }, 300),
    )
  }

  function preloadReferences(form: Readonly<DclVehicleForm>): void {
    void load('vehicleType', form.vehicleType, form)
    void load(
      form.carrierType === 'INTERNAL'
        ? 'carrierOperatingEntityId'
        : 'carrierServiceRelationshipObjectId',
      '',
      form,
    )
  }

  if (getCurrentScope()) {
    onScopeDispose(() => {
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
    })
  }

  return { editorFields, preloadReferences, searchEditorReference }
}

async function loadOptions(
  key: ReferenceKey,
  keyword: string,
): Promise<BusinessObjectFieldOption<string>[]> {
  if (key === 'vehicleType') {
    const { data } = await apiClient.postContract('aux/dictionary-item/query', {
      page: 1,
      pageSize: 20,
      filters: {
        dictionaryTypeCode: 'DCT-0002',
        enabled: true,
        ...(keyword ? { keyword } : {}),
      },
      sort: [{ field: 'name', order: 'asc' }],
    })
    return data.items.map((item) => ({
      title: formatReferenceLabel({ code: item.code, name: item.data.name ?? '' }),
      value: item.code,
    }))
  }
  if (key === 'carrierOperatingEntityId') {
    const { data } = await apiClient.postContract(
      'bob/operating-entity/query',
      {
        page: 1,
        pageSize: 20,
        filters: { enabled: true, ...(keyword ? { keyword } : {}) },
        sort: [{ field: 'name', order: 'asc' }],
      },
    )
    return data.items.map((item) => ({
      title: formatReferenceLabel({
        code: item.code,
        name: item.data.name ?? '',
      }),
      value: item.objectId,
    }))
  }
  const { data } = await apiClient.postContract('bob/other-unit/query', {
    page: 1,
    pageSize: 20,
    filters: {
      enabled: true,
      ...(keyword ? { keyword } : {}),
    },
  })
  return data.items.map((item) => ({
    title: formatReferenceLabel({
      code: item.code,
      name: item.relationship?.partyDisplayName ?? '',
    }),
    value: item.objectId,
  }))
}

function isReferenceKey(key: string): key is ReferenceKey {
  return (
    key === 'vehicleType' ||
    key === 'carrierOperatingEntityId' ||
    key === 'carrierServiceRelationshipObjectId'
  )
}

function fieldIsVisible(
  key: ReferenceKey,
  form: Readonly<DclVehicleForm>,
): boolean {
  return (
    key === 'vehicleType' ||
    (key === 'carrierOperatingEntityId' && form.carrierType === 'INTERNAL') ||
    (key === 'carrierServiceRelationshipObjectId' &&
      form.carrierType === 'EXTERNAL')
  )
}

function referenceLabel(key: ReferenceKey): string {
  return {
    vehicleType: '车型',
    carrierOperatingEntityId: '经营主体',
    carrierServiceRelationshipObjectId: '其他单位服务关系',
  }[key]
}
