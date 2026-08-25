import { readdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, relative, resolve } from 'node:path'

const frontendRoot = resolve(import.meta.dirname, '..')
const sourceRoot = resolve(frontendRoot, 'src')
const generatedSchemaPath = resolve(sourceRoot, 'api/generated/schema.ts')
const generatedMetadataPath = resolve(
  sourceRoot,
  'api/generated/contract-meta.ts',
)
const bundledContractPath = resolve(
  frontendRoot,
  '../contracts/openapi/dist/openapi.json',
)
function sourceFiles(directory) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (path !== join(sourceRoot, 'api', 'generated')) {
        files.push(...sourceFiles(path))
      }
    } else if (entry.isFile() && /\.(?:ts|vue)$/.test(entry.name)) {
      files.push(path)
    }
  }
  return files
}

const files = sourceFiles(sourceRoot)

const forbidden = [
  {
    pattern: /\bapiClient\.post(?:\s*<|\s*\()/,
    reason: '普通 JSON 业务调用必须使用 postContract',
  },
  {
    pattern: /\basync\s+post\s*</,
    reason: 'ApiClient 不得暴露 generic post',
  },
  {
    pattern: /\bas\s+ApiPostPath\b/,
    reason: '调用方不得通过 ApiPostPath cast 绕过生成 path',
  },
  {
    pattern: /\b(?:interface|type)\s+Wire[A-Za-z0-9_]*/,
    reason: '不得维护手写 wire DTO',
  },
]

const violations = []
const generatedMetadata = readFileSync(generatedMetadataPath, 'utf8')
const metadataHash = generatedMetadata.match(
  /contractMetaSourceHash = '([a-f0-9]{64})'/,
)?.[1]
const bundledHash = createHash('sha256')
  .update(JSON.stringify(JSON.parse(readFileSync(bundledContractPath, 'utf8'))))
  .digest('hex')
if (metadataHash !== bundledHash) {
  violations.push(
    'generated contract metadata is stale; run make generate before checking API client residue',
  )
}
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n')
  for (const [index, line] of lines.entries()) {
    for (const rule of forbidden) {
      if (rule.pattern.test(line)) {
        violations.push(
          `${relative(frontendRoot, file)}:${index + 1}: ${rule.reason}`,
        )
      }
    }
  }
}

function generatedOperation(path) {
  const schema = readFileSync(generatedSchemaPath, 'utf8')
  const escaped = path.replace(/[.*+?^$()|[\]\\]/g, '\\$&')
  const match = schema.match(
    new RegExp('^  "' + escaped + '": \\{([\\s\\S]*?)^  \\};', 'm'),
  )
  return match?.[1]
}

function generatedPath(sourcePath) {
  const direct = '/' + sourcePath
  if (generatedOperation(direct)) return direct

  const [domain, _entity, action] = sourcePath.split('/')
  if (
    action &&
    (domain === 'bob' || domain === 'aux' || domain === 'vou') &&
    !action.includes('$' + '{')
  ) {
    return '/' + domain + '/{entity}/' + action
  }
  if (action && domain === 'wfl' && !action.includes('$' + '{')) {
    return '/wfl/{processName}/' + action
  }
  if (action && domain === 'rpt' && !action.includes('$' + '{')) {
    return '/rpt/{report}/' + action
  }
  return undefined
}

const actualContractCalls = []
const callPattern = new RegExp(
  "\\bapiClient\\.postContract\\(\\s*(?:'([^']+)'|" +
    String.fromCharCode(96) +
    '([^' +
    String.fromCharCode(96) +
    ']+)' +
    String.fromCharCode(96) +
    ')',
  'gs',
)
for (const file of files) {
  const source = readFileSync(file, 'utf8')
  for (const match of source.matchAll(callPattern)) {
    const path = generatedPath(match[1] ?? match[2])
    if (path) actualContractCalls.push({ file, path })
  }
}

for (const { file, path } of actualContractCalls) {
  const operation = generatedOperation(path)
  if (!operation) {
    violations.push(
      relative(frontendRoot, file) +
        ': postContract path ' +
        path +
        ' is absent from generated OpenAPI paths',
    )
  } else if (operation.includes('Models.BusinessEnvelope')) {
    violations.push(
      relative(frontendRoot, file) +
        ': postContract path ' +
        path +
        ' resolves to generic BusinessEnvelope response',
    )
  }
}

const generatedSchema = readFileSync(generatedSchemaPath, 'utf8')
for (const match of generatedSchema.matchAll(
  /^  "(\/[^"]+)": \{([\s\S]*?)^  \};/gm,
)) {
  if (
    match[2].includes('post:') &&
    match[2].includes('Models.BusinessEnvelope')
  ) {
    violations.push(
      'generated OpenAPI path ' +
        match[1] +
        ' exposes generic BusinessEnvelope for a POST response',
    )
  }
}

if (violations.length) {
  console.error(violations.join('\n'))
  process.exit(1)
}

process.stdout.write(
  `API contract client residue check passed (${files.length} files).\n`,
)
