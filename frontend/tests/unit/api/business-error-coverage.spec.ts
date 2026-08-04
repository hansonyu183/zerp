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
})
