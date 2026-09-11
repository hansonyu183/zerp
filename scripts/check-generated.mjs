import { execFileSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export function checkGeneratedArtifacts(
  root = path.resolve(import.meta.dirname, '..'),
) {
  const changes = execFileSync(
    'git',
    [
      '-C',
      root,
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
      '--',
      'apps/api/src/generated',
      'apps/api/src/db/generated.ts',
    ],
    { encoding: 'utf8' },
  )
  if (changes) {
    process.stderr.write(
      `生成物存在漂移，请运行 make generate 并提交生成结果：\n${changes}`,
    )
    return 1
  }
  process.stdout.write('生成物检查通过：业务契约与数据库类型无漂移。\n')
  return 0
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = checkGeneratedArtifacts()
}
