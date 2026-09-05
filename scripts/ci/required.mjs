const REQUIRED_BY_LEVEL = Object.freeze({
  L0: Object.freeze(['changes', 'common']),
  L1: Object.freeze(['changes', 'common', 'tooling']),
  L3: Object.freeze(['changes', 'common', 'tooling', 'target']),
})

const JOBS = Object.freeze(['changes', 'common', 'tooling', 'target'])

export function requirementsForLevel(level) {
  const requirements = REQUIRED_BY_LEVEL[level]
  return requirements ? [...requirements] : null
}

export function satisfiesRequiredJobs(level, results) {
  const requiredJobs = requirementsForLevel(level)
  if (!requiredJobs) {
    return { ok: false, error: `invalid CI level: ${String(level)}` }
  }
  if (!results || typeof results !== 'object' || Array.isArray(results)) {
    return { ok: false, error: 'job results must be an object' }
  }

  const required = new Set(requiredJobs)
  for (const job of JOBS) {
    const result = results[job]
    if (result === 'success') {
      continue
    }
    if (result === 'skipped' && !required.has(job)) {
      continue
    }
    if (typeof result !== 'string' || result.length === 0) {
      return { ok: false, error: `${job} has an invalid result` }
    }
    if (result === 'skipped') {
      return {
        ok: false,
        error: `${job} is required for ${level} and must be success`,
      }
    }
    return { ok: false, error: `${job} must be success, received ${result}` }
  }
  return { ok: true }
}

function parseArgs(argv) {
  const expectedFlags = [
    '--level',
    '--changes',
    '--common',
    '--tooling',
    '--target',
  ]
  if (argv.length !== expectedFlags.length * 2) {
    throw new Error(
      'usage: node scripts/ci/required.mjs --level <L0|L1|L3> --changes <result> --common <result> --tooling <result> --target <result>',
    )
  }

  const values = {}
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (
      !expectedFlags.includes(flag) ||
      Object.hasOwn(values, flag) ||
      value.startsWith('--')
    ) {
      throw new Error(
        'usage: node scripts/ci/required.mjs --level <L0|L1|L3> --changes <result> --common <result> --tooling <result> --target <result>',
      )
    }
    values[flag] = value
  }
  if (Object.keys(values).length !== expectedFlags.length) {
    throw new Error(
      'usage: node scripts/ci/required.mjs --level <L0|L1|L3> --changes <result> --common <result> --tooling <result> --target <result>',
    )
  }

  return {
    level: values['--level'],
    results: {
      changes: values['--changes'],
      common: values['--common'],
      tooling: values['--tooling'],
      target: values['--target'],
    },
  }
}

function main() {
  const { level, results } = parseArgs(process.argv.slice(2))
  const verdict = satisfiesRequiredJobs(level, results)
  if (!verdict.ok) {
    throw new Error(verdict.error)
  }
}

if (import.meta.main) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`CI required-job check failed: ${error.message}\n`)
    process.exitCode = 1
  }
}
