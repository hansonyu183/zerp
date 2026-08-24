import { readFile, writeFile } from 'node:fs/promises'

const [inputPath, outputPath] = process.argv.slice(2)
if (!inputPath || !outputPath) {
  throw new Error(
    'usage: prepare-openapi-models.mjs <openapi.json> <models.json>',
  )
}

const document = JSON.parse(await readFile(inputPath, 'utf8'))
const modelsDocument = {
  openapi: document.openapi,
  info: document.info,
  paths: {},
  components: { schemas: document.components?.schemas ?? {} },
}

await writeFile(outputPath, JSON.stringify(modelsDocument))
