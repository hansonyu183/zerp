import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import {
  archiveDraftReady,
  createArchiveDraft,
} from '../../../src/target/archive-drafts.ts'
import ArchiveReferenceEditor from '../../../src/target/archive-reference-editor.vue'
import {
  archiveEditorFields,
  archiveReadOnlySummary,
} from '../../../src/target/archive-presentation.ts'
import ArchiveStructuredEditor from '../../../src/target/archive-structured-editor.vue'
import { normalizeTargetBobReferenceCandidate } from '../../../src/target/api.ts'

describe('target archive structured editor', () => {
  it('renders and saves the ordinary archive fields declared by the page matrix', async () => {
    const draft = createArchiveDraft('owner-1', 'operating-entity')
    const wrapper = mount(ArchiveStructuredEditor, {
      props: {
        draft,
        fields: archiveEditorFields('operating-entity'),
      },
    })

    const legalName = wrapper.get('input[type="text"]')
    await legalName.setValue('目标经营主体')
    expect(draft.snapshot.legalName).toBe('目标经营主体')
    expect(wrapper.text()).toContain('统一社会信用代码')
    expect(wrapper.emitted('save')).toHaveLength(1)
  })

  it('renders ACC Mapping as typed Chinese controls instead of a JSON editor', async () => {
    const wrapper = mount(ArchiveStructuredEditor, {
      props: { draft: createArchiveDraft('owner-1', 'acc-mapping') },
    })

    expect(wrapper.text()).toContain('凭证模板')
    expect(wrapper.text()).toContain('条件规则')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '添加规则')!
      .trigger('click')
    expect(wrapper.text()).toContain('不记账')
    expect(wrapper.find('textarea').exists()).toBe(false)
  })

  it('presents protocol capability values in Chinese and saves typed changes', async () => {
    const wrapper = mount(ArchiveStructuredEditor, {
      props: { draft: createArchiveDraft('owner-1', 'sales-partner') },
    })

    expect(wrapper.text()).toContain('外部兼职销售')
    expect(wrapper.text()).toContain('渠道合作方')
    expect(wrapper.text()).not.toContain('EXTERNAL_PART_TIME')
    expect(wrapper.text()).not.toContain('CHANNEL_PARTNER')

    const checkbox = wrapper.find('input[type="checkbox"]')
    await checkbox.setValue(true)
    expect(wrapper.emitted('save')).toHaveLength(1)
  })

  it('edits every Customer subunit business field without a JSON textarea', async () => {
    const wrapper = mount(ArchiveStructuredEditor, {
      props: { draft: createArchiveDraft('owner-1', 'customer') },
    })

    expect(wrapper.text()).toContain('结算方式')
    expect(wrapper.text()).toContain('信用额度')
    expect(wrapper.text()).toContain('销售归属')
    expect(wrapper.text()).toContain('业务附件')
    await wrapper.get('button', { name: '添加信用额度' }).trigger('click')
    await wrapper.get('button', { name: '选择结算方式' }).trigger('click')
    expect(wrapper.emitted('save')).toHaveLength(2)
  })

  it('edits ACC dimensions and asset configuration as named fields', async () => {
    const wrapper = mount(ArchiveStructuredEditor, {
      props: { draft: createArchiveDraft('owner-1', 'acc-mapping') },
    })

    await wrapper.get('button', { name: '启用固定资产配置' }).trigger('click')
    await wrapper.get('button', { name: '添加模板' }).trigger('click')
    await wrapper.get('button', { name: '添加分录' }).trigger('click')
    await wrapper.get('button', { name: '添加维度' }).trigger('click')
    expect(wrapper.emitted('save')).toHaveLength(2)
  })

  it('uses catalog selections for stable ACC identifiers and source fields', async () => {
    const wrapper = mount(ArchiveStructuredEditor, {
      props: {
        draft: createArchiveDraft('owner-1', 'acc-mapping'),
        referenceOptions: {
          accBook: [{ id: 'book-1', code: 'BOOK', name: '账簿' }],
          accVouEntity: [
            {
              id: 'vou-1',
              code: 'VOU',
              name: '凭证',
              fieldCatalog: {
                headerFields: ['amount'],
                lineFields: ['currency'],
              },
            },
          ],
          accSubject: [
            {
              id: 'subject-1',
              bookId: 'book-1',
              code: '1001',
              name: '现金',
              requiredDimensions: ['department'],
            },
          ],
        },
      },
    })
    expect(wrapper.findAll('input[maxlength="26"]')).toHaveLength(0)
  })

  it('keeps carrier selections visible and does not make an empty selection submit-ready', async () => {
    const option = {
      objectId: 'entity-1',
      approvalEntryId: 'approval-1',
      code: 'OE',
      name: '经营主体',
    }
    const reference = mount(ArchiveReferenceEditor, {
      props: {
        label: '承运方引用',
        value: {
          operatingEntityId: 'entity-1',
          approvalEntryId: 'approval-1',
          code: 'OE',
          name: '经营主体',
        },
        options: [option],
      },
    })
    expect((reference.get('select').element as HTMLSelectElement).value).toBe(
      'entity-1',
    )
    await reference.get('select').setValue('')
    expect(reference.emitted('select')?.[0]).toEqual([{}])

    const draft = createArchiveDraft('owner-1', 'vehicle')
    expect(archiveDraftReady(draft)).toBe(false)
    expect(JSON.stringify(draft.snapshot)).not.toContain('undefined')
  })

  it('normalizes BOB approval wire into an exact candidate and gates vehicle readiness', () => {
    const candidate = normalizeTargetBobReferenceCandidate({
      objectId: 'entity-1',
      sourceApprovalEntryId: 'approval-1',
      code: 'OE',
      name: '经营主体',
    })
    expect(candidate).toEqual({
      objectId: 'entity-1',
      approvalEntryId: 'approval-1',
      code: 'OE',
      name: '经营主体',
    })

    const draft = createArchiveDraft('owner-1', 'vehicle')
    if (draft.entity !== 'vehicle') throw new Error('vehicle draft expected')
    draft.snapshot.vehicleType = { id: 'type-1', code: 'TRUCK', name: '货车' }
    draft.snapshot.carrier = {
      kind: 'INTERNAL',
      operatingEntityId: candidate.objectId,
      approvalEntryId: candidate.approvalEntryId,
    }
    expect(archiveDraftReady(draft)).toBe(true)
    draft.snapshot.carrier.approvalEntryId = ''
    expect(archiveDraftReady(draft)).toBe(false)
  })

  it('presents the authoritative product behavior wire values in Chinese', async () => {
    const wrapper = mount(ArchiveStructuredEditor, {
      props: {
        draft: createArchiveDraft('owner-1', 'product'),
        referenceOptions: {
          productType: [
            {
              objectId: 'type-1',
              code: 'RAW',
              name: '原料类型',
              behaviorProfile: 'RAW_MATERIAL',
            },
          ],
        },
      },
    })
    await wrapper.find('fieldset.reference-editor select').setValue('type-1')
    expect(wrapper.text()).toContain('原材料')
    expect(wrapper.text()).not.toContain('RAW_MATERIAL')
  })

  it('renders historical snapshots as Chinese read-only summary fields', () => {
    expect(
      archiveReadOnlySummary('customer', {
        identityKind: 'MAINLAND_ENTERPRISE',
        legalName: '测试客户',
        enabled: true,
      }),
    ).toEqual(
      expect.arrayContaining([
        { label: '客户身份类型', value: '大陆企业' },
        { label: '法定名称', value: '测试客户' },
        { label: '启用', value: '是' },
      ]),
    )
  })
})
