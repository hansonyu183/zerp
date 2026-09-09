import type { WflSubmitNewInput, wflTrial, wflSubmission } from '../../api.ts'
export type WflData = {
  script: string | null
  compiledGraph:
    Awaited<ReturnType<typeof wflSubmission>>['compiledGraph'] | null
  trialDocument: WflSubmitNewInput['trialDocument'] | null
  trial: Awaited<ReturnType<typeof wflTrial>> | null
}
export const wflErrors: Record<string, string> = {
  wfl_definition_in_use: '该版本已有流程实例引用，不能反批准。',
  wfl_compile_failed: '脚本编译失败，请检查定义。',
  wfl_trial_failed: '真实单据试算失败。',
  wfl_trial_document_not_found: '试算单据不存在。',
  wfl_definition_code_conflict: '流程代码已被其他定义使用。',
}
