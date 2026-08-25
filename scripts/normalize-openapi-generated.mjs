import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const [outputDirectory] = process.argv.slice(2)
if (!outputDirectory) {
  throw new Error('usage: normalize-openapi-generated.mjs <output-directory>')
}

function normalizeDirectory(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      normalizeDirectory(path)
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue

    const source = readFileSync(path, 'utf8')
    const normalized = source.replace(/(?:\r?\n[\t ]*)+$/u, '\n')
    if (normalized !== source) writeFileSync(path, normalized)
  }
}

normalizeDirectory(resolve(outputDirectory))
