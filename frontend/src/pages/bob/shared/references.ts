import {
  computed,
  getCurrentScope,
  onScopeDispose,
  reactive,
  type Ref,
} from 'vue'
import { apiClient } from '@/api/client'
import { getErrorMessage } from '@/api/types'
import type { BusinessObjectFieldOption } from '@/components/business-object'
import { useSessionStore } from '@/stores/session'
import { formatReferenceLabel } from '@/utils/reference-label'
import type {
  BobEntityConfig,
  BobFilterField,
  BobForm,
  BobReferenceConfig,
} from './types'

interface ReferenceState {
  options: BusinessObjectFieldOption<string>[]
  loading: boolean
  errorMessage: string | null
  requestSequence: number
}

function referenceName(item: unknown): string {
  if (!item || typeof item !== 'object') return ''
  const record = item as Record<string, unknown>
  if (typeof record.partyDisplayName === 'string') return record.partyDisplayName
  const relationship = record.relationship
  if (relationship && typeof relationship === 'object') {
    const partyDisplayName = (relationship as Record<string, unknown>)
      .partyDisplayName
    if (typeof partyDisplayName === 'string') return partyDisplayName
  }
  const data = record.data
  if (!data || typeof data !== 'object') return ''
  const name = (data as Record<string, unknown>).name
  return typeof name === 'string' ? name : ''
}

function createReferenceState(): ReferenceState {
  return {
    options: [],
    loading: false,
    errorMessage: null,
    requestSequence: 0,
  }
}

function hasValue(value: unknown): boolean {
  return !(
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0) ||
    value === false
  )
}

export function useBobReferences(
  config: Pick<BobEntityConfig, 'references' | 'filters' | 'fields'>,
  editorMode: Ref<'create' | 'edit' | 'view'>,
  filters: Ref<Record<string, unknown>>,
) {
  const session = useSessionStore()
  const referenceStates = reactive<Record<string, ReferenceState>>({})
  const searchTimers = new Map<string, ReturnType<typeof setTimeout>>()

  function referenceState(key: string): ReferenceState {
    if (!referenceStates[key]) referenceStates[key] = createReferenceState()
    return referenceStates[key]
  }

  for (const key of Object.keys(config.references ?? {})) {
    referenceState(`editor:${key}`)
  }
  for (const field of config.filters) {
    if (field.reference) referenceState(`filter:${field.key}`)
  }

  const referenceOptions = computed(() =>
    Object.fromEntries(
      Object.keys(config.references ?? {}).map((key) => [
        key,
        referenceState(`editor:${key}`).options,
      ]),
    ),
  )
  const referenceLoading = computed(() =>
    Object.fromEntries(
      Object.keys(config.references ?? {}).map((key) => [
        key,
        referenceState(`editor:${key}`).loading,
      ]),
    ),
  )
  const referenceErrors = computed(() =>
    Object.fromEntries(
      Object.keys(config.references ?? {}).map((key) => [
        key,
        referenceState(`editor:${key}`).errorMessage,
      ]),
    ),
  )
  const editorFields = computed(() =>
    config.fields({
      mode: editorMode.value,
      referenceOptions: referenceOptions.value,
      referenceLoading: referenceLoading.value,
      referenceErrors: referenceErrors.value,
    }),
  )

  async function hydrateReferences(form: Readonly<BobForm>): Promise<void> {
    await Promise.all(
      Object.entries(config.references ?? {}).map(async ([key, reference]) => {
        const value = form[key]
        if (typeof value !== 'string' || !value) return
        const state = referenceState(`editor:${key}`)
        if (state.options.some((option) => option.value === value)) return

        const snapshotCode = form[`${key}Code`]
        const snapshotName = form[`${key}Name`]
        if (
          typeof snapshotCode === 'string' &&
          typeof snapshotName === 'string'
        ) {
          state.options = [
            ...state.options.filter((option) => option.value !== value),
            {
              title: formatReferenceLabel({
                code: snapshotCode,
                name: snapshotName,
              }),
              value,
            },
          ]
          return
        }

        const domain = reference.domain ?? 'bob'
        const action = reference.value === 'code' ? 'query' : 'get'
        if (!session.can(`/${domain}/${reference.entity}/${action}`)) {
          state.options = [...state.options, { title: value, value }]
          return
        }
        try {
          if (reference.value === 'code') {
            if (reference.domain === 'aux') {
              const { data } = await apiClient.postContract(
                `aux/${reference.entity}/query`,
                {
                  page: 1,
                  pageSize: 20,
                  filters: {
                    ...resolveReferenceFilters(reference, form),
                    keyword: value,
                    enabled: true,
                  },
                  sort: [{ field: 'name', order: 'asc' }],
                },
              )
              const item = data.items.find(
                (candidate) => candidate.code === value,
              )
              if (!item) {
                state.options = [...state.options, { title: value, value }]
                return
              }
              state.options = [
                ...state.options.filter((option) => option.value !== value),
                {
                  title: formatReferenceLabel({
                    code: item.code,
                    name: item.data.name ?? '',
                  }),
                  value,
                  metadata: { ...item.data },
                },
              ]
              return
            }

            const { data } =
              reference.entity === 'other-unit'
                ? await apiClient.postContract('bob/other-unit/query', {
                    page: 1,
                    pageSize: 20,
                    filters: {
                      ...resolveReferenceFilters(reference, form),
                      keyword: value,
                    },
                  })
                : await apiClient.postContract(
                    `bob/${reference.entity}/query`,
                    {
                      page: 1,
                      pageSize: 20,
                      filters: {
                        ...resolveReferenceFilters(reference, form),
                        keyword: value,
                        status: ['APPROVED'],
                        enabled: true,
                      },
                      sort: [{ field: 'name', order: 'asc' }],
                    },
                  )
            const item = data.items.find(
              (candidate) => candidate.code === value,
            )
            if (!item) {
              state.options = [...state.options, { title: value, value }]
              return
            }
            state.options = [
              ...state.options.filter((option) => option.value !== value),
              {
                title: formatReferenceLabel({
                  code: item.code,
                  name: referenceName(item),
                }),
                value,
              },
            ]
            return
          }

          if (reference.domain === 'aux') {
            const { data } = await apiClient.postContract(
              `aux/${reference.entity}/get`,
              { objectId: value },
            )
            state.options = [
              ...state.options.filter((option) => option.value !== value),
              {
                title: formatReferenceLabel({
                  code: data.code,
                  name: data.data.name ?? '',
                }),
                value,
                metadata: { ...data.data },
              },
            ]
            return
          }

          const { data } =
            reference.entity === 'other-unit'
              ? await apiClient.postContract('bob/other-unit/get', {
                  objectId: value,
                })
              : await apiClient.postContract(`bob/${reference.entity}/get`, {
                  objectId: value,
                })
          state.options = [
            ...state.options.filter((option) => option.value !== value),
            {
              title: formatReferenceLabel({
                code: data.code,
                name: referenceName(data),
              }),
              value,
            },
          ]
        } catch {
          state.options = [...state.options, { title: value, value }]
        }
      }),
    )
  }

  function resolveReferenceFilters(
    reference: BobReferenceConfig,
    form: Readonly<BobForm>,
  ): Record<string, unknown> {
    const values =
      typeof reference.filters === 'function'
        ? reference.filters(form)
        : (reference.filters ?? {})
    return Object.fromEntries(
      Object.entries(values).filter(([, value]) => hasValue(value)),
    )
  }

  async function loadReference(
    stateKey: string,
    reference: BobReferenceConfig,
    keywordValue: string,
    form: Readonly<BobForm>,
  ): Promise<void> {
    const state = referenceState(stateKey)
    const domain = reference.domain ?? 'bob'
    if (!session.can(`/${domain}/${reference.entity}/query`)) {
      state.errorMessage = `缺少${reference.label}查询权限。`
      return
    }

    const sequence = state.requestSequence + 1
    state.requestSequence = sequence
    state.loading = true
    state.errorMessage = null
    try {
      const keywordFilter = keywordValue.trim()
      let loaded: BusinessObjectFieldOption<string>[]
      if (reference.domain === 'aux') {
        loaded = (
          await apiClient.postContract(`aux/${reference.entity}/query`, {
            page: 1,
            pageSize: 20,
            filters: {
              ...resolveReferenceFilters(reference, form),
              ...(keywordFilter ? { keyword: keywordFilter } : {}),
              enabled: true,
            },
            sort: [{ field: 'name', order: 'asc' }],
          })
        ).data.items.map((item) => ({
          title: formatReferenceLabel({
            code: item.code,
            name: item.data.name ?? '',
          }),
          value: reference.value === 'code' ? item.code : item.objectId,
          metadata: { ...item.data },
        }))
      } else if (reference.entity === 'other-unit') {
        loaded = (
          await apiClient.postContract('bob/other-unit/query', {
            page: 1,
            pageSize: 20,
            filters: {
              ...resolveReferenceFilters(reference, form),
              ...(keywordFilter ? { keyword: keywordFilter } : {}),
            },
          })
        ).data.items.map((item) => ({
          title: formatReferenceLabel({
            code: item.code,
            name: referenceName(item),
          }),
          value: reference.value === 'code' ? item.code : item.objectId,
        }))
      } else {
        loaded = (
          await apiClient.postContract(`bob/${reference.entity}/query`, {
            page: 1,
            pageSize: 20,
            filters: {
              ...resolveReferenceFilters(reference, form),
              ...(keywordFilter ? { keyword: keywordFilter } : {}),
              status: ['APPROVED'],
              enabled: true,
            },
            sort: [{ field: 'name', order: 'asc' }],
          })
        ).data.items.map((item) => ({
          title: formatReferenceLabel({
            code: item.code,
            name: referenceName(item),
          }),
          value: reference.value === 'code' ? item.code : item.objectId,
        }))
      }
      if (state.requestSequence !== sequence) return
      const selected = state.options.filter((option) =>
        Object.values(form).includes(option.value),
      )
      state.options = [...selected, ...loaded].filter(
        (option, index, all) =>
          all.findIndex((candidate) => candidate.value === option.value) ===
          index,
      )
    } catch (error) {
      if (state.requestSequence === sequence) {
        state.errorMessage = `${reference.label}加载失败：${getErrorMessage(error)}`
      }
    } finally {
      if (state.requestSequence === sequence) state.loading = false
    }
  }

  function scheduleReference(
    stateKey: string,
    reference: BobReferenceConfig,
    keywordValue: string,
    form: Readonly<BobForm>,
  ): void {
    const previous = searchTimers.get(stateKey)
    if (previous) clearTimeout(previous)
    searchTimers.set(
      stateKey,
      setTimeout(() => {
        searchTimers.delete(stateKey)
        void loadReference(stateKey, reference, keywordValue, form)
      }, 300),
    )
  }

  function searchEditorReference(
    key: string,
    keywordValue: string,
    form: Readonly<BobForm>,
  ): void {
    const reference = config.references?.[key]
    if (!reference) return
    scheduleReference(`editor:${key}`, reference, keywordValue, form)
  }

  function filterField(key: string): BobFilterField | undefined {
    return config.filters.find((field) => field.key === key)
  }

  function searchFilterReference(key: string, keywordValue: string): void {
    const field = filterField(key)
    if (!field?.reference) return
    scheduleReference(
      `filter:${key}`,
      field.reference,
      keywordValue,
      filters.value as BobForm,
    )
  }

  function filterReferenceOptions(key: string) {
    return referenceState(`filter:${key}`).options
  }

  function filterReferenceLoading(key: string): boolean {
    return referenceState(`filter:${key}`).loading
  }

  function filterReferenceError(key: string): string | null {
    return referenceState(`filter:${key}`).errorMessage
  }

  function preloadEditorReferences(form: Readonly<BobForm>): void {
    for (const [key, reference] of Object.entries(config.references ?? {})) {
      void loadReference(`editor:${key}`, reference, '', form)
    }
  }

  if (getCurrentScope()) {
    onScopeDispose(() => {
      for (const timer of searchTimers.values()) clearTimeout(timer)
      searchTimers.clear()
    })
  }

  return {
    editorFields,
    hydrateReferences,
    preloadEditorReferences,
    searchEditorReference,
    searchFilterReference,
    filterReferenceOptions,
    filterReferenceLoading,
    filterReferenceError,
  }
}
