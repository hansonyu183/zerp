import { defineComponent, reactive } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { apiClient } from '@/api/client'
import {
  useFeedbackViewModel,
  type FeedbackAttachmentDraft,
} from '@/components/feedback/vm'

vi.mock('@/api/client', () => ({
  apiClient: {
    post: vi.fn(),
    uploadFeedbackAttachment: vi.fn(),
  },
}))

const mockedApiClient = vi.mocked(apiClient)
const Harness = defineComponent({
  setup() {
    return { vm: reactive(useFeedbackViewModel()) }
  },
  template: '<div />',
})

function screenshot(name = 'screen.png', type = 'image/png', size = 7): File {
  const file = new File(['content'], name, { type, lastModified: 1 })
  Object.defineProperty(file, 'size', { configurable: true, value: size })
  if (typeof file.arrayBuffer !== 'function') {
    Object.defineProperty(file, 'arrayBuffer', {
      configurable: true,
      value: vi
        .fn()
        .mockResolvedValue(new TextEncoder().encode('content').buffer),
    })
  }
  return file
}

async function mountHarness(path = '/vou/sale-order') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }],
  })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(Harness, { global: { plugins: [router] } })
  return {
    wrapper,
    router,
    vm: (
      wrapper.vm as unknown as {
        vm: ReturnType<typeof useFeedbackViewModel>
      }
    ).vm,
  }
}

describe('feedback view model', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:feedback-preview')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    vi.spyOn(crypto.subtle, 'digest').mockResolvedValue(new ArrayBuffer(32))
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(
      '12345678-1234-4123-8123-123456789abc',
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('限制截图类型、大小、数量和重复文件', async () => {
    const { wrapper, vm } = await mountHarness()

    vm.addFiles([screenshot('bad.webp', 'image/webp')])
    expect(vm.attachmentError).toContain('PNG/JPEG')
    expect(vm.attachments).toHaveLength(0)

    vm.addFiles([
      screenshot('one.png'),
      screenshot('two.png'),
      screenshot('three.png'),
      screenshot('four.png'),
    ])
    expect(vm.attachmentError).toContain('最多添加 3 张')

    const first = screenshot('one.png')
    vm.addFiles([first])
    vm.addFiles([first])
    expect(vm.attachmentError).toBe('同一张截图不能重复添加。')
    expect(vm.attachments).toHaveLength(1)

    wrapper.unmount()
  })

  it('初始化并上传截图后提交当前页面反馈', async () => {
    mockedApiClient.post.mockImplementation(async (path) => {
      if (path === 'app/feedback/attachment-initiate') {
        return {
          data: {
            fileId: '01J00000000000000000000000',
            uploadUrl: '/files/feedback/attachments/upload/token-1',
            expiresAt: '2026-07-25T12:00:00Z',
          },
        }
      }
      if (path === 'app/feedback/create') {
        return {
          data: {
            feedbackId: '01J00000000000000000000001',
            status: 'PENDING',
            submittedAt: '2026-07-25T11:00:00Z',
          },
        }
      }
      throw new Error(`unexpected path: ${path}`)
    })
    mockedApiClient.uploadFeedbackAttachment.mockResolvedValue()

    const { wrapper, vm } = await mountHarness()
    vm.openDialog()
    vm.category = 'BUG'
    vm.title = '保存失败'
    vm.content = '点击保存后页面提示失败'
    vm.relatedRequestId = 'request-123'
    vm.addFiles([screenshot()])

    await vm.submit()

    expect(mockedApiClient.post).toHaveBeenNthCalledWith(
      1,
      'app/feedback/attachment-initiate',
      expect.objectContaining({
        fileName: 'screen.png',
        contentType: 'image/png',
        size: 7,
        sha256: '0'.repeat(64),
      }),
    )
    expect(mockedApiClient.uploadFeedbackAttachment).toHaveBeenCalledWith(
      '/files/feedback/attachments/upload/token-1',
      expect.any(File),
    )
    expect(mockedApiClient.post).toHaveBeenNthCalledWith(
      2,
      'app/feedback/create',
      {
        submissionKey: '12345678-1234-4123-8123-123456789abc',
        category: 'BUG',
        title: '保存失败',
        content: '点击保存后页面提示失败',
        pagePath: '/vou/sale-order',
        clientVersion: '',
        relatedRequestId: 'request-123',
        attachmentIds: ['01J00000000000000000000000'],
      },
    )
    expect(vm.created?.feedbackId).toBe('01J00000000000000000000001')
    expect(vm.attachments).toHaveLength(0)

    wrapper.unmount()
  })

  it('提交失败时保留已上传截图供重试', async () => {
    let createAttempts = 0
    mockedApiClient.post.mockImplementation(async (path) => {
      if (path === 'app/feedback/attachment-initiate') {
        return {
          data: {
            fileId: '01J00000000000000000000000',
            uploadUrl: '/files/feedback/attachments/upload/token-1',
            expiresAt: '2026-07-25T12:00:00Z',
          },
        }
      }
      if (path === 'app/feedback/create') {
        createAttempts += 1
        if (createAttempts === 1) throw new Error('提交失败')
        return {
          data: {
            feedbackId: '01J00000000000000000000001',
            status: 'PENDING',
            submittedAt: '2026-07-25T11:00:00Z',
          },
        }
      }
      if (path === 'app/feedback/attachment-remove') return { data: {} }
      throw new Error(`unexpected path: ${path}`)
    })
    mockedApiClient.uploadFeedbackAttachment.mockResolvedValue()

    const { wrapper, vm } = await mountHarness()
    vm.openDialog()
    vm.title = '问题'
    vm.content = '详细问题描述'
    vm.addFiles([screenshot()])

    await vm.submit()

    const uploaded = vm.attachments[0] as FeedbackAttachmentDraft
    expect(uploaded.status).toBe('ready')
    expect(vm.errorMessage).toBe('提交失败')

    await vm.submit()
    expect(mockedApiClient.uploadFeedbackAttachment).toHaveBeenCalledTimes(1)
    expect(createAttempts).toBe(2)
    const createCalls = mockedApiClient.post.mock.calls.filter(
      ([path]) => path === 'app/feedback/create',
    )
    expect(createCalls[0]?.[1]).toMatchObject({
      submissionKey: '12345678-1234-4123-8123-123456789abc',
    })
    expect(createCalls[1]?.[1]).toMatchObject({
      submissionKey: '12345678-1234-4123-8123-123456789abc',
    })

    wrapper.unmount()
  })

  it('关闭弹窗时在当前会话内保留草稿', async () => {
    const { wrapper, vm } = await mountHarness('/bob/customer')
    vm.openDialog()
    vm.title = '客户页面建议'
    vm.content = '希望增加批量操作'
    vm.closeDialog()
    vm.openDialog()

    expect(vm.title).toBe('客户页面建议')
    expect(vm.content).toBe('希望增加批量操作')
    expect(vm.pagePath).toBe('/bob/customer')

    wrapper.unmount()
  })

  it('跨页面恢复草稿时保留草稿最初关联的页面', async () => {
    const { wrapper, router, vm } = await mountHarness('/vou/sale-order')
    vm.openDialog()
    vm.closeDialog()

    await router.push('/bob/customer')
    vm.openDialog()
    expect(vm.pagePath).toBe('/bob/customer')

    vm.title = '客户页面建议'
    vm.content = '希望增加批量操作'
    vm.closeDialog()
    await router.push('/vou/sales-receipt')
    vm.openDialog()

    expect(vm.title).toBe('客户页面建议')
    expect(vm.content).toBe('希望增加批量操作')
    expect(vm.pagePath).toBe('/bob/customer')

    wrapper.unmount()
  })

  it('拒绝包含空格或非 ASCII 字符的关联请求编号', async () => {
    const { wrapper, vm } = await mountHarness()
    vm.title = '问题'
    vm.content = '详细问题描述'

    vm.relatedRequestId = 'request 123'
    expect(vm.requestIdValid).toBe(false)
    expect(vm.canSubmit).toBe(false)

    vm.relatedRequestId = '请求-123'
    expect(vm.requestIdValid).toBe(false)

    vm.relatedRequestId = 'request-123'
    expect(vm.requestIdValid).toBe(true)
    expect(vm.canSubmit).toBe(true)

    wrapper.unmount()
  })
})
