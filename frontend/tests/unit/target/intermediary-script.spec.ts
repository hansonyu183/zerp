import { expect, it } from 'vitest'
import { runIntermediaryScript } from '../../../src/target/components/document-page/intermediary-script.ts'
const input = {
  periodStart: '2026-09-01',
  periodEnd: '2026-09-30',
  currency: 'CNY' as const,
  lines: [],
  bills: [],
}
it('executes the supplied script against JSON facts with no host capabilities', async () => {
  const source = `globalThis.calculate = input => {
    if (typeof fetch !== 'undefined' || typeof process !== 'undefined' || typeof document !== 'undefined') throw Error('host exposed');
    if (input.periodEnd !== '2026-09-30') throw Error('input missing');
    return { lines: [], summaries: [] };
  }`
  expect(await runIntermediaryScript(source, input)).toEqual({
    lines: [],
    summaries: [],
  })
  await expect(runIntermediaryScript('', input)).rejects.toThrow()
})
it('interrupts a script that never terminates and can run another script afterwards', async () => {
  await expect(runIntermediaryScript('while (true) {}', input)).rejects.toThrow(
    '脚本执行失败',
  )
  expect(
    await runIntermediaryScript(
      'globalThis.calculate = () => ({lines: [], summaries: []})',
      input,
    ),
  ).toEqual({ lines: [], summaries: [] })
})
it('rejects asynchronous results', async () => {
  await expect(
    runIntermediaryScript(
      'globalThis.calculate = async () => ({lines: [], summaries: []})',
      input,
    ),
  ).rejects.toThrow()
})
it('uses the current supplied formula without retaining the prior script context', async () => {
  const calculate = (rate: number) =>
    `globalThis.calculate = () => ({lines:[{employeeAmount: (3 * ${rate}).toFixed(2)}], summaries:[]})`
  expect(
    (await runIntermediaryScript(calculate(1), input)).lines[0]?.employeeAmount,
  ).toBe('3.00')
  expect(
    (await runIntermediaryScript(calculate(2), input)).lines[0]?.employeeAmount,
  ).toBe('6.00')
})
