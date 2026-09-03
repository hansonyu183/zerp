import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

function blankExceptNewlines(value) {
  return value.replace(/[^\n]/gu, ' ')
}

function stripCommentsAndStringLiterals(source) {
  let result = ''
  let index = 0

  while (index < source.length) {
    if (source.startsWith('--', index)) {
      const end = source.indexOf('\n', index)
      const next = end === -1 ? source.length : end
      result += blankExceptNewlines(source.slice(index, next))
      index = next
      continue
    }
    if (source.startsWith('/*', index)) {
      const end = source.indexOf('*/', index + 2)
      const next = end === -1 ? source.length : end + 2
      result += blankExceptNewlines(source.slice(index, next))
      index = next
      continue
    }
    if (source[index] === "'") {
      let next = index + 1
      while (next < source.length) {
        if (source[next] !== "'") {
          next += 1
          continue
        }
        if (source[next + 1] === "'") {
          next += 2
          continue
        }
        next += 1
        break
      }
      result += blankExceptNewlines(source.slice(index, next))
      index = next
      continue
    }
    if (source[index] === '$') {
      const delimiter = source
        .slice(index)
        .match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/u)?.[0]
      if (delimiter) {
        const close = source.indexOf(delimiter, index + delimiter.length)
        const next = close === -1 ? source.length : close + delimiter.length
        result += blankExceptNewlines(source.slice(index, next))
        index = next
        continue
      }
    }
    result += source[index]
    index += 1
  }

  return result
}

const forbiddenPatterns = [
  {
    kind: 'custom function',
    pattern: /\b(?:CREATE\s+(?:OR\s+REPLACE\s+)?|DROP\s+)FUNCTION\b/giu,
  },
  {
    kind: 'custom procedure',
    pattern: /\b(?:CREATE\s+(?:OR\s+REPLACE\s+)?|DROP\s+)PROCEDURE\b/giu,
  },
  {
    kind: 'trigger',
    pattern: /\b(?:CREATE\s+(?:(?:CONSTRAINT|EVENT)\s+)?|DROP\s+)TRIGGER\b/giu,
  },
  {
    kind: 'trigger routine registration',
    pattern: /\bEXECUTE\s+(?:FUNCTION|PROCEDURE)\b/giu,
  },
  {
    kind: 'trigger control',
    pattern: /\bALTER\s+TABLE\b[^;]*?\b(?:ENABLE|DISABLE)\s+TRIGGER\b/giu,
  },
]

export function findDatabaseBoundaryViolations(source) {
  const inspectable = stripCommentsAndStringLiterals(source)
  const violations = []

  for (const { kind, pattern } of forbiddenPatterns) {
    pattern.lastIndex = 0
    for (const match of inspectable.matchAll(pattern)) {
      violations.push({
        kind,
        line: inspectable.slice(0, match.index).split('\n').length,
        statement: match[0].replace(/\s+/gu, ' '),
        index: match.index,
      })
    }
  }

  return violations
    .sort((left, right) => left.index - right.index)
    .map(({ index: _, ...violation }) => violation)
}

async function main() {
  const schemaPath =
    process.argv[2] ??
    fileURLToPath(new URL('../backend/db/schema.sql', import.meta.url))
  const violations = findDatabaseBoundaryViolations(
    await readFile(schemaPath, 'utf8'),
  )
  if (violations.length === 0) {
    return
  }
  for (const violation of violations) {
    console.error(
      `${schemaPath}:${violation.line}: ${violation.kind}: ${violation.statement}`,
    )
  }
  process.exitCode = 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
