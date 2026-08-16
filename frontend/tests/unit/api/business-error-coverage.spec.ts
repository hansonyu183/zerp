import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { translateBusinessMessage } from '@/api/business-error-messages'
import { containsChineseText } from '@/api/types'

const domainsRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../backend/internal/domains',
)

function goFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return goFiles(path)
    return entry.isFile() &&
      entry.name.endsWith('.go') &&
      !entry.name.endsWith('_test.go')
      ? [path]
      : []
  })
}

function staticDomainMessages(): string[] {
  const messages = new Set<string>()
  const patterns = [
    /domainError\([^\n]*?,\s*"([^"]+)"/gu,
    /errors\.New\("([^"]+)"\)/gu,
    /\b(?:validation|conflict)\("([^"]+)"/gu,
    /txevent\.Reject\("([^"]+)"/gu,
  ]
  for (const file of goFiles(domainsRoot)) {
    const source = readFileSync(file, 'utf8')
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        const message = match[1]?.trim()
        if (message) messages.add(message)
      }
    }
  }
  return [...messages].sort()
}

describe('backend business error coverage', () => {
  it('为全站静态业务错误提供中文用户提示', () => {
    const untranslated = staticDomainMessages().filter(
      (message) =>
        message !== 'internal server error' &&
        !containsChineseText(message) &&
        !translateBusinessMessage(message),
    )

    expect(untranslated).toEqual([])
  })

  it('为流程与实时结算错误保留具体中文业务含义', () => {
    expect(
      Object.fromEntries(
        [
          'accounting settlement balance is unavailable',
          'process definition code already exists',
          'process definition changed',
          'the current draft requires a successful document trial before publication',
          'publish the workflow before enabling it',
          'only unused draft definitions can be deleted',
          'requestKey is already bound to another workflow intent',
          'the original create-child result is no longer available; use a new requestKey',
          'the workflow target is no longer available',
          'workflow target is not currently available',
          'workflow action result is already registered at another position',
          'multiple enabled workflows match this document',
        ].map((message) => [message, translateBusinessMessage(message)]),
      ),
    ).toEqual({
      'accounting settlement balance is unavailable':
        '结算余额暂时不可用，请稍后重试。',
      'process definition code already exists':
        '流程编码已存在，请使用其他编码。',
      'process definition changed': '流程定义已被其他操作修改，请刷新后重试。',
      'the current draft requires a successful document trial before publication':
        '当前草稿必须先使用真实单据成功试算，才能发布。',
      'publish the workflow before enabling it':
        '请先发布流程修订，再启用流程。',
      'only unused draft definitions can be deleted':
        '只能删除尚未使用的草稿流程。',
      'requestKey is already bound to another workflow intent':
        '该请求键已用于其他创建意图，请使用新的请求键。',
      'the original create-child result is no longer available; use a new requestKey':
        '原创建结果已不存在，请使用新的请求键重新创建。',
      'the workflow target is no longer available':
        '当前流程目标已不可用，请刷新后重新选择。',
      'workflow target is not currently available':
        '当前条件不允许创建该流程目标，请刷新后重试。',
      'workflow action result is already registered at another position':
        '该动作结果已登记在流程中的其他位置，不能重复登记。',
      'multiple enabled workflows match this document':
        '当前单据同时命中多个已启用流程，请先停用冲突流程。',
    })
  })
})
