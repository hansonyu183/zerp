import { readFile, writeFile } from 'node:fs/promises'

const [inputPath, outputPath] = process.argv.slice(2)
if (!inputPath || !outputPath) {
  throw new Error(
    'usage: generate-openapi-path-types.mjs <openapi.json> <schema.ts>',
  )
}

const document = JSON.parse(await readFile(inputPath, 'utf8'))

function resolveReference(reference) {
  if (!reference.startsWith('#/'))
    throw new Error(`unsupported reference: ${reference}`)
  return reference
    .slice(2)
    .split('/')
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce((value, segment) => value?.[segment], document)
}

function schemaType(schema) {
  if (!schema) return 'unknown'
  if (schema.$ref) return `Models.${schema.$ref.split('/').at(-1)}`
  if (schema.oneOf) return schema.oneOf.map(schemaType).join(' | ')
  if (schema.anyOf) return schema.anyOf.map(schemaType).join(' | ')
  if (schema.enum)
    return schema.enum.map((value) => JSON.stringify(value)).join(' | ')
  if (schema.type === 'array') return `Array<${schemaType(schema.items)}>`
  if (schema.type === 'integer' || schema.type === 'number') return 'number'
  if (schema.type === 'boolean') return 'boolean'
  if (schema.type === 'string') return 'string'
  return 'unknown'
}

function parametersFor(pathItem, operation) {
  const parameters = [
    ...(pathItem.parameters ?? []),
    ...(operation?.parameters ?? []),
  ]
  const pathParameters = parameters
    .map((parameter) =>
      parameter.$ref ? resolveReference(parameter.$ref) : parameter,
    )
    .filter((parameter) => parameter.in === 'path')
  if (pathParameters.length === 0) return 'path?: never;'
  const properties = pathParameters.map(
    (parameter) =>
      `${JSON.stringify(parameter.name)}: ${schemaType(parameter.schema)};`,
  )
  return `path: { ${properties.join(' ')} };`
}

function requestType(operation) {
  if (!operation.requestBody) return 'never'
  const requestBody = operation.requestBody.$ref
    ? resolveReference(operation.requestBody.$ref)
    : operation.requestBody
  return schemaType(requestBody.content?.['application/json']?.schema)
}

function responseType(operation) {
  let response = operation.responses?.['200']
  if (!response) return 'unknown'
  if (response.$ref) response = resolveReference(response.$ref)
  return schemaType(response.content?.['application/json']?.schema)
}

function operationType(pathItem, operation) {
  return `{
      parameters: { query?: never; header?: never; ${parametersFor(pathItem, operation)} cookie?: never };
      requestBody: { content: { 'application/json': ${requestType(operation)} } };
      responses: { 200: { content: { 'application/json': ${responseType(operation)} } } };
    }`
}

const pathLines = Object.entries(document.paths).map(([path, pathItem]) => {
  const post = pathItem.post
    ? `post: ${operationType(pathItem, pathItem.post)};`
    : 'post?: never;'
  return `  ${JSON.stringify(path)}: {
    parameters: { query?: never; header?: never; ${parametersFor(pathItem)} cookie?: never };
    ${post}
  };`
})

const schemaLines = Object.keys(document.components?.schemas ?? {}).map(
  (name) => `      ${JSON.stringify(name)}: Models.${name};`,
)

const output = `/**
 * This file was auto-generated from the bundled OpenAPI contract.
 * Do not make direct changes to the file.
 */

import type * as Models from './index'

export interface paths {
${pathLines.join('\n')}
}

export interface components {
  schemas: {
${schemaLines.join('\n')}
  };
  responses: never;
  parameters: never;
  requestBodies: never;
  headers: never;
  pathItems: never;
}
`

await writeFile(outputPath, output)
