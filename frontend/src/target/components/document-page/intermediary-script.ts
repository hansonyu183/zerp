import { getQuickJS } from 'quickjs-emscripten'
import type { VouIntermediaryCalculationInput } from '@zerp/model'

/** A fresh isolated VM per run; no host functions or module loader are exposed. */
export async function runIntermediaryScript(
  source: string,
  input: VouIntermediaryCalculationInput['source'],
): Promise<VouIntermediaryCalculationInput['result']> {
  const quickJS = await getQuickJS()
  const runtime = quickJS.newRuntime()
  runtime.setMemoryLimit(16 * 1024 * 1024)
  runtime.setMaxStackSize(320 * 1024)
  const deadline = Date.now() + 2000
  runtime.setInterruptHandler(() => Date.now() >= deadline)
  const context = runtime.newContext()
  try {
    const evaluate = (code: string) => {
      const result = context.evalCode(code)
      if (result.error) {
        result.error.dispose()
        throw new Error('脚本执行失败，请检查语法、计算入口及资源限制。')
      }
      return result.value
    }
    evaluate(source).dispose()
    const result = evaluate(`
      (() => {
      if (typeof globalThis.calculate !== 'function') throw new Error('calculate required');
      const result = globalThis.calculate(${JSON.stringify(input)});
      if (!result || typeof result.then === 'function') throw new Error('synchronous result required');
      return JSON.stringify(result);
      })();
    `)
    try {
      const json = context.getString(result)
      const value: unknown = JSON.parse(json)
      if (
        !value ||
        typeof value !== 'object' ||
        !('lines' in value) ||
        !Array.isArray(value.lines) ||
        !('summaries' in value) ||
        !Array.isArray(value.summaries)
      )
        throw new Error('脚本必须返回明细及收款方汇总。')
      return value as VouIntermediaryCalculationInput['result']
    } finally {
      result.dispose()
    }
  } finally {
    context.dispose()
    runtime.dispose()
  }
}
