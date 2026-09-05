import { readFile } from 'node:fs/promises'

const LEVELS = Object.freeze({ L0: 0, L1: 1, L3: 3 })

const L0_PATHS = new Set([
  'README.md',
  'AGENTS.md',
  'CONTEXT.md',
  'frontend/README.md',
  'frontend/AGENTS.md',
])

const L1_PATHS = new Set([
  '.prettierignore',
  '.prettierrc.json',
  '.github/workflows/ci.yml',
  'scripts/check-docs.mjs',
  'scripts/check-docs.test.mjs',
  'scripts/check-ci-workflow.test.mjs',
  'scripts/ci/classify.mjs',
  'scripts/ci/classify.test.mjs',
  'scripts/ci/required.mjs',
  'scripts/ci/required.test.mjs',
])

function levelForPath(path) {
  if (L0_PATHS.has(path) || /^docs\/.+\.md$/.test(path)) {
    return 'L0'
  }
  if (L1_PATHS.has(path)) {
    return 'L1'
  }
  return 'L3'
}

export function classifyPaths(paths) {
  if (!Array.isArray(paths)) {
    throw new TypeError('paths must be an array')
  }

  let level = 'L0'
  for (const path of paths) {
    if (typeof path !== 'string') {
      throw new TypeError('each path must be a string')
    }
    const candidate = levelForPath(path)
    if (LEVELS[candidate] > LEVELS[level]) {
      level = candidate
    }
  }
  return level
}

function parseArgs(argv) {
  if (
    argv.length !== 2 ||
    argv[0] !== '--paths-file' ||
    argv[1].startsWith('--')
  ) {
    throw new Error('usage: node scripts/ci/classify.mjs --paths-file <file>')
  }
  return argv[1]
}

function parsePaths(contents) {
  return contents
    .split('\n')
    .map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))
    .filter((line) => line !== '')
}

async function main() {
  const pathsFile = parseArgs(process.argv.slice(2))
  const contents = await readFile(pathsFile, 'utf8')
  process.stdout.write(`${classifyPaths(parsePaths(contents))}\n`)
}

if (import.meta.main) {
  main().catch((error) => {
    process.stderr.write(`CI path classification failed: ${error.message}\n`)
    process.exitCode = 1
  })
}
