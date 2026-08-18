import fs from 'node:fs'
import path from 'node:path'
import console from 'node:console'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'

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

function propertyName(node, sourceFile) {
  return node.name?.getText(sourceFile).replace(/^['"]|['"]$/g, '')
}

function hasProperty(object, name, sourceFile) {
  return (
    object &&
    ts.isObjectLiteralExpression(object) &&
    object.properties.some(
      (property) =>
        ts.isPropertyAssignment(property) &&
        propertyName(property, sourceFile) === name,
    )
  )
}

function hasExactTrue(object, sourceFile) {
  return (
    object &&
    ts.isObjectLiteralExpression(object) &&
    object.properties.some(
      (property) =>
        ts.isPropertyAssignment(property) &&
        propertyName(property, sourceFile) === 'exact' &&
        property.initializer.kind === ts.SyntaxKind.TrueKeyword,
    )
  )
}

function violation(sourceFile, node, message) {
  const line = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile),
  )
  return `${sourceFile.fileName}:${line.line + 1}: @system-serial ${message}`
}

function inspectStrictLocators(sourceFile, violations) {
  if (!sourceFile.text.includes('@system-serial')) {
    return
  }

  function visit(node) {
    if (
      !ts.isCallExpression(node) ||
      !ts.isPropertyAccessExpression(node.expression)
    ) {
      ts.forEachChild(node, visit)
      return
    }

    const method = node.expression.name.text
    const [target, options] = node.arguments
    if (
      method === 'getByLabel' &&
      ts.isStringLiteralLike(target) &&
      !hasExactTrue(options, sourceFile)
    ) {
      violations.push(
        violation(sourceFile, node, 'getByLabel requires { exact: true }'),
      )
    }

    if (
      method === 'getByRole' &&
      ts.isStringLiteralLike(target) &&
      interactiveRoles.has(target.text) &&
      (!hasProperty(options, 'name', sourceFile) ||
        !hasExactTrue(options, sourceFile))
    ) {
      violations.push(
        violation(sourceFile, node, 'getByRole requires name and exact: true'),
      )
    }

    if (
      node.arguments.some(
        (argument) =>
          ts.isObjectLiteralExpression(argument) &&
          hasExactForce(argument, sourceFile),
      )
    ) {
      violations.push(
        violation(sourceFile, node, 'tests cannot use force: true'),
      )
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
}

function hasExactForce(object, sourceFile) {
  return object.properties.some(
    (property) =>
      ts.isPropertyAssignment(property) &&
      propertyName(property, sourceFile) === 'force' &&
      property.initializer.kind === ts.SyntaxKind.TrueKeyword,
  )
}

export function validateE2EConstraintSources({ testSources }) {
  const violations = []
  for (const [fileName, source] of Object.entries(testSources)) {
    const sourceFile = ts.createSourceFile(
      fileName,
      source,
      ts.ScriptTarget.Latest,
      true,
    )
    inspectStrictLocators(sourceFile, violations)
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
