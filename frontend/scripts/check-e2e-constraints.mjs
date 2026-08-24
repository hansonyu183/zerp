import fs from 'node:fs'
import path from 'node:path'
import console from 'node:console'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { parseSync, Visitor } from 'oxc-parser'

const interactiveRoles = new Set(['button', 'combobox', 'option', 'textbox'])
const sourceExtensions = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mts',
  '.cts',
  '.mjs',
  '.cjs',
])

function propertyName(property) {
  if (property.key?.type === 'Identifier') return property.key.name
  if (property.key?.type === 'Literal') return String(property.key.value)
  return undefined
}

function hasProperty(object, name) {
  return (
    object &&
    object.type === 'ObjectExpression' &&
    object.properties.some(
      (property) =>
        property.type === 'Property' && propertyName(property) === name,
    )
  )
}

function hasTrueProperty(object, name) {
  return (
    object &&
    object.type === 'ObjectExpression' &&
    object.properties.some(
      (property) =>
        property.type === 'Property' &&
        propertyName(property) === name &&
        property.value.type === 'Literal' &&
        property.value.value === true,
    )
  )
}

function violation(fileName, source, node, message) {
  const line = source.slice(0, node.start).split('\n').length
  return `${fileName}:${line}: @system-serial ${message}`
}

function inspectStrictLocators(fileName, source, program, violations) {
  if (!source.includes('@system-serial')) return

  new Visitor({
    CallExpression(node) {
      if (
        node.callee.type !== 'MemberExpression' ||
        node.callee.property.type !== 'Identifier'
      ) {
        return
      }

      const method = node.callee.property.name
      const [target, options] = node.arguments
      if (
        method === 'getByLabel' &&
        target?.type === 'Literal' &&
        typeof target.value === 'string' &&
        !hasTrueProperty(options, 'exact')
      ) {
        violations.push(
          violation(
            fileName,
            source,
            node,
            'getByLabel requires { exact: true }',
          ),
        )
      }

      if (
        method === 'getByRole' &&
        target?.type === 'Literal' &&
        typeof target.value === 'string' &&
        interactiveRoles.has(target.value) &&
        (!hasProperty(options, 'name') || !hasTrueProperty(options, 'exact'))
      ) {
        violations.push(
          violation(
            fileName,
            source,
            node,
            'getByRole requires name and exact: true',
          ),
        )
      }

      if (
        node.arguments.some((argument) => hasTrueProperty(argument, 'force'))
      ) {
        violations.push(
          violation(fileName, source, node, 'tests cannot use force: true'),
        )
      }
    },
  }).visit(program)
}

export function validateE2EConstraintSources({ testSources }) {
  const violations = []
  for (const [fileName, source] of Object.entries(testSources)) {
    const parsed = parseSync(fileName, source)
    if (parsed.errors.length > 0) {
      throw new Error(`${fileName}: ${parsed.errors[0].message}`)
    }
    inspectStrictLocators(fileName, source, parsed.program, violations)
  }
  return violations
}

export function checkRepositoryE2EConstraints(frontendRoot) {
  const testDir = path.join(frontendRoot, 'tests/e2e')
  const paths = []
  function collect(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) collect(entryPath)
      else if (
        entry.isFile() &&
        sourceExtensions.has(path.extname(entry.name))
      ) {
        paths.push(entryPath)
      }
    }
  }
  collect(testDir)
  const testSources = Object.fromEntries(
    paths.map((filePath) => [
      path.relative(frontendRoot, filePath),
      fs.readFileSync(filePath, 'utf8'),
    ]),
  )
  return validateE2EConstraintSources({ testSources })
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const frontendRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
  )
  const violations = checkRepositoryE2EConstraints(frontendRoot)
  if (violations.length) {
    console.error(violations.join('\n'))
    process.exit(1)
  }
}
